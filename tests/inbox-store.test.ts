import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InboxError, type InboxAttachment } from '../shared/inbox.js';
import { Vault, tokenHash } from '../server/crypto.js';
import { InboxStore } from '../server/inbox/store.js';
import { Store } from '../server/store.js';

const NOW=1_800_000_000_000;
const DAY=86_400_000;
const KEY=Buffer.alloc(32,31).toString('base64');
const attachment:InboxAttachment={id:'attachment',name:'private-file-name.txt',url:'https://cdn.discordapp.com/attachments/private-link?secret=query',size:12};
function setup(t:TestContext) {
  let now=NOW;
  t.mock.method(Date,'now',()=>now);
  const vault=new Vault(KEY),base=new Store(':memory:',vault),store=new InboxStore(base.db,vault);
  t.after(()=>base.close());
  return {store,db:base.db,vault,setNow:(value:number)=>{now=value;}};
}
function incoming(guildId='guild-a',memberId='member-a',discordMessageId=`discord-${guildId}`) {
  return {guildId,memberId,discordMessageId,content:'Private incoming body',attachments:[] as InboxAttachment[],createdAt:Date.now()};
}
function status(code:number) {return (error:unknown)=>error instanceof InboxError && error.statusCode===code;}

test('inbox schema coexists with root migrations and settings default disabled',t=>{
  const {store,db,vault}=setup(t);
  const version=db.prepare('PRAGMA user_version').get();
  new InboxStore(db,vault);
  assert.deepEqual(db.prepare('PRAGMA user_version').get(),version);
  assert.deepEqual(store.getSettings('guild-a'),{enabled:false});
  assert.deepEqual(store.enabledGuildIds(),[]);
  store.setSettings('guild-a',true); store.setSettings('guild-b',true); store.setSettings('guild-b',false);
  assert.deepEqual(store.enabledGuildIds(),['guild-a']);
  assert.deepEqual(store.getSettings('guild-b'),{enabled:false});
});

test('message content and attachment metadata only occur inside authenticated ciphertext',t=>{
  const {store,db}=setup(t);
  const received=store.receive({...incoming(),attachments:[attachment]});
  const reply=store.prepareReply('guild-a',received.ticket.id,'admin','request-1','Confidential reply body');
  const rows=db.prepare('SELECT * FROM inbox_messages').all();
  const serialized=JSON.stringify(rows);
  for(const privateText of ['Private incoming body','Confidential reply body',attachment.name,attachment.url,attachment.id]) {
    assert.equal(serialized.includes(privateText),false);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity').get()!.n,0);
  assert.deepEqual(store.listMessages('guild-a',received.ticket.id).messages.map(message=>message.id),[received.message.id,reply.message.id]);
  assert.deepEqual(store.listMessages('guild-a',received.ticket.id).messages[0].attachments,[attachment]);
});

test('moving ciphertext to another message or guild fails closed with a safe error',t=>{
  const {store,db}=setup(t);
  const first=store.receive(incoming());
  const second=store.receive(incoming('guild-a','member-b','discord-2'));
  const row=db.prepare('SELECT payload FROM inbox_messages WHERE guild_id=? AND id=?').get('guild-a',first.message.id)!;
  db.prepare('UPDATE inbox_messages SET payload=? WHERE guild_id=? AND id=?').run(row.payload,'guild-a',second.message.id);
  assert.throws(()=>store.listMessages('guild-a',second.ticket.id),status(500));
  assert.throws(()=>store.listMessages('guild-a',second.ticket.id),/could not be read securely/);
  const other=store.receive(incoming('guild-b','member-c','discord-3'));
  db.prepare('UPDATE inbox_messages SET id=?,payload=? WHERE guild_id=? AND id=?').run(first.message.id,row.payload,'guild-b',other.message.id);
  assert.throws(()=>store.listMessages('guild-b',other.ticket.id),status(500));
  assert.equal(store.listMessages('guild-a',first.ticket.id).messages[0].content,'Private incoming body');
});

test('message authentication rejects changed routing metadata, source IDs and retention dates',t=>{
  const {store,db}=setup(t);
  const first=store.receive(incoming()),other=store.receive(incoming('guild-a','member-b','other-source'));
  for(const [column,value] of [['ticket_id',other.ticket.id],['actor_id','other-member'],['direction','outgoing'],
    ['discord_message_id','changed-source'],['created_at',NOW+1]] as const) {
    db.exec('SAVEPOINT tamper');
    db.prepare(`UPDATE inbox_messages SET ${column}=? WHERE id=?`).run(value,first.message.id);
    assert.throws(()=>store.listMessages('guild-a',column==='ticket_id'?other.ticket.id:first.ticket.id),status(500));
    db.exec('ROLLBACK TO tamper; RELEASE tamper');
  }
  store.prepareReply('guild-a',first.ticket.id,'admin','original-request','Reply');
  db.prepare('UPDATE inbox_messages SET request_id=? WHERE request_id=?').run('changed-request','original-request');
  assert.throws(()=>store.getReply('guild-a',first.ticket.id,'changed-request'),status(500));
});

test('an incoming Discord DM cannot be replayed into a different server after routing changes',t=>{
  const {store,db}=setup(t);
  const source=incoming();
  const first=store.receive(source);
  assert.throws(()=>store.receive({...source,guildId:'guild-b'}),status(409));
  assert.throws(()=>store.receive({...source,memberId:'other-member'}),status(409));
  assert.equal(store.receive(source).message.id,first.message.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_messages').get()!.n,1);
  assert.deepEqual(store.listTickets('guild-b','open'),{tickets:[],nextOffset:null});
});

test('ticket and reply reads, writes, and removal are isolated by guild',t=>{
  const {store,db}=setup(t);
  const first=store.receive(incoming());
  const second=store.receive(incoming('guild-b'));
  store.prepareReply('guild-a',first.ticket.id,'admin','same-request','Reply A');
  store.prepareReply('guild-b',second.ticket.id,'admin','same-request','Reply B');
  assert.equal(store.getTicket('guild-b',first.ticket.id),null);
  assert.deepEqual(store.listMessages('guild-b',first.ticket.id),{messages:[],nextBefore:null});
  assert.equal(store.getReply('guild-b',first.ticket.id,'same-request'),null);
  assert.throws(()=>store.finishReply('guild-b',first.ticket.id,'same-request','sent','id'),status(404));
  assert.throws(()=>store.closeTicket('guild-b',first.ticket.id),status(404));
  assert.throws(()=>store.prepareReply('guild-c',first.ticket.id,'admin','new','Wrong guild'),status(404));
  store.setSettings('guild-a',true); store.setSettings('guild-b',true);
  store.setRoute('member-a','guild-a'); store.setRoute('member-b','guild-b');
  const choice=store.createChoice('chooser',['guild-a','guild-b']);
  db.prepare('INSERT INTO activity(guild_id,actor_id,action,created_at) VALUES(?,?,?,?)').run('guild-a','admin','untouched',NOW);
  store.removeGuild('guild-a');
  assert.equal(store.getTicket('guild-a',first.ticket.id),null);
  assert.equal(store.getSettings('guild-a').enabled,false);
  assert.equal(store.getRoute('member-a'),null);
  assert.equal(store.getRoute('member-b'),'guild-b');
  assert.equal(store.getReply('guild-b',second.ticket.id,'same-request')?.content,'Reply B');
  assert.equal(store.consumeChoice(choice,'chooser','guild-a'),false);
  assert.equal(store.consumeChoice(choice,'chooser','guild-b'),true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity').get()!.n,1);
});

test('incoming dedup precedes ticket creation and closed tickets get a new conversation only for a new message',t=>{
  const {store,db}=setup(t);
  const first=store.receive(incoming());
  assert.equal(store.receive(incoming()).created,false);
  const followup=store.receive(incoming('guild-a','member-a','discord-2'));
  assert.equal(followup.ticket.id,first.ticket.id);
  assert.throws(()=>store.receive(incoming('guild-a','different-member')),status(409));
  store.closeTicket('guild-a',first.ticket.id);
  const duplicate=store.receive(incoming());
  assert.equal(duplicate.created,false);
  assert.equal(duplicate.ticket.status,'closed');
  assert.deepEqual(store.listTickets('guild-a','open').tickets,[]);
  const next=store.receive(incoming('guild-a','member-a','discord-3'));
  assert.notEqual(next.ticket.id,first.ticket.id);
  assert.equal(store.listTickets('guild-a','closed').tickets.length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_messages').get()!.n,3);
});

test('reply request IDs bind actor, ticket and exact content and remain idempotent after closure',t=>{
  const {store}=setup(t);
  const first=store.receive(incoming()),second=store.receive(incoming('guild-a','member-b','discord-2'));
  const prepared=store.prepareReply('guild-a',first.ticket.id,'admin','request','Reply');
  assert.equal(prepared.created,true);
  assert.equal(prepared.message.status,'pending');
  assert.deepEqual(store.prepareReply('guild-a',first.ticket.id,'admin','request','Reply'),{created:false,message:prepared.message});
  for(const args of [[first.ticket.id,'other-admin','Reply'],[second.ticket.id,'admin','Reply'],[first.ticket.id,'admin','Changed']] as const) {
    assert.throws(()=>store.prepareReply('guild-a',args[0],args[1],'request',args[2]),status(409));
  }
  const sent=store.finishReply('guild-a',first.ticket.id,'request','sent','discord-reply');
  assert.equal(sent.status,'sent');
  assert.deepEqual(store.finishReply('guild-a',first.ticket.id,'request','failed',null),sent);
  assert.deepEqual(store.finishReply('guild-a',first.ticket.id,'request','uncertain',null),sent);
  store.closeTicket('guild-a',first.ticket.id);
  assert.deepEqual(store.prepareReply('guild-a',first.ticket.id,'admin','request','Reply'),{created:false,message:sent});
  assert.throws(()=>store.prepareReply('guild-a',first.ticket.id,'admin','new-request','Reply'),status(409));
});

test('recovering a restart marks only pending replies uncertain and never resends',t=>{
  const {store}=setup(t);
  const {ticket}=store.receive(incoming());
  for(const request of ['pending','sent','failed']) store.prepareReply('guild-a',ticket.id,'admin',request,'Reply');
  store.finishReply('guild-a',ticket.id,'sent','sent','sent-id');
  store.finishReply('guild-a',ticket.id,'failed','failed',null);
  store.recoverPendingReplies();
  assert.deepEqual(['pending','sent','failed'].map(request=>store.getReply('guild-a',ticket.id,request)?.status),['uncertain','sent','failed']);
  assert.equal(store.prepareReply('guild-a',ticket.id,'admin','pending','Reply').created,false);
});

test('choice tokens are hashed, user-bound, guild-bound, single use and expire at ten minutes',t=>{
  const {store,db}=setup(t);
  const token=store.createChoice('member',['guild-a','guild-b']);
  const rows=db.prepare('SELECT * FROM inbox_choices').all();
  assert.equal(JSON.stringify(rows).includes(token),false);
  assert.equal(rows[0].token_hash,tokenHash(token));
  assert.equal(store.consumeChoice(token,'other-member','guild-a'),false);
  assert.equal(store.consumeChoice(token,'member','guild-c'),false);
  assert.equal(store.consumeChoice(token,'member','guild-b',NOW+600_000-1),true);
  assert.equal(store.consumeChoice(token,'member','guild-a'),false);
  const expiring=store.createChoice('member',['guild-a']);
  assert.equal(store.consumeChoice(expiring,'member','guild-a',NOW+600_000),false);
  assert.throws(()=>store.createChoice('member',[]),status(400));
  assert.throws(()=>store.createChoice('member',Array.from({length:26},(_,i)=>`guild-${i}`)),status(400));
});

test('routes expire exactly after 24 hours and clear and replace only the chosen user',t=>{
  const {store}=setup(t);
  store.setRoute('a','guild-a'); store.setRoute('b','guild-b'); store.setRoute('a','guild-c');
  assert.equal(store.getRoute('a',NOW+DAY-1),'guild-c');
  assert.equal(store.getRoute('a',NOW+DAY),null);
  store.clearRoute('a');
  assert.equal(store.getRoute('a'),null);
  assert.equal(store.getRoute('b'),'guild-b');
});

test('retention is enforced immediately on every read and pruning deletes empty tickets and expired routes and choices',t=>{
  const {store,db,setNow}=setup(t);
  const first=store.receive(incoming());
  const empty=store.receive(incoming('guild-a','other-member','empty-ticket'));
  store.prepareReply('guild-a',first.ticket.id,'admin','old-reply','Old reply');
  setNow(NOW+1);
  const retained=store.receive(incoming('guild-a','member-a','retained'));
  store.setRoute('member','guild-a'); store.createChoice('member',['guild-a']);
  setNow(NOW+90*DAY);
  assert.deepEqual(store.listMessages('guild-a',first.ticket.id).messages.map(message=>message.id),[retained.message.id]);
  assert.equal(store.getReply('guild-a',first.ticket.id,'old-reply'),null);
  assert.equal(store.getTicket('guild-a',empty.ticket.id),null);
  assert.deepEqual(store.listTickets('guild-a','open').tickets.map(ticket=>ticket.id),[first.ticket.id]);
  assert.throws(()=>store.finishReply('guild-a',first.ticket.id,'old-reply','sent','id'),status(404));
  store.prune();
  for(const [table,expected] of [['inbox_messages',1],['inbox_tickets',1],['inbox_routes',0],['inbox_choices',0]] as const) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,expected);
  }
});

test('incoming validation enforces content and attachment limits, supports attachments only, and bounds timestamps',t=>{
  const {store}=setup(t);
  for(const patch of [
    {content:'x'.repeat(4001)}, {content:'   '}, {attachments:Array(11).fill(attachment)},
    {createdAt:NOW-90*DAY}, {createdAt:NOW-90*DAY-1}, {createdAt:NaN},
  ]) assert.throws(()=>store.receive({...incoming(),...patch}),status(400));
  const valid=store.receive({...incoming(),content:'',attachments:[attachment],createdAt:NOW+DAY});
  assert.equal(valid.message.content,'');
  assert.equal(valid.message.createdAt,NOW);
  assert.throws(()=>store.prepareReply('guild-a',valid.ticket.id,'admin','long','x'.repeat(2001)),status(400));
  assert.throws(()=>store.prepareReply('guild-a',valid.ticket.id,'admin','blank','  '),status(400));
});

test('ticket and message pagination is bounded, tenant scoped and returns chronological messages',t=>{
  const {store,setNow}=setup(t);
  const first=store.receive(incoming());
  for(let i=1;i<105;i++) store.receive(incoming('guild-a','member-a',`discord-${i+1}`));
  store.receive(incoming('guild-b'));
  const page=store.listMessages('guild-a',first.ticket.id);
  assert.equal(page.messages.length,100);
  assert.ok(page.nextBefore);
  assert.equal(page.nextBefore,page.messages[0].seq);
  assert.deepEqual(page.messages.map(message=>message.seq),[...page.messages.map(message=>message.seq)].sort((a,b)=>a-b));
  const older=store.listMessages('guild-a',first.ticket.id,page.nextBefore!);
  assert.equal(older.messages.length,5);
  assert.equal(older.nextBefore,null);
  assert.ok(older.messages.at(-1)!.seq<page.messages[0].seq);
  for(let i=1;i<52;i++) {setNow(NOW+i);store.receive(incoming('guild-a',`member-${i}`,`ticket-${i}`));}
  const tickets=store.listTickets('guild-a','open');
  assert.equal(tickets.tickets.length,50); assert.equal(tickets.nextOffset,50);
  const next=store.listTickets('guild-a','open',50);
  assert.equal(next.tickets.length,2); assert.equal(next.nextOffset,null);
  assert.equal(new Set([...tickets.tickets,...next.tickets].map(ticket=>ticket.id)).size,52);
});

test('failed message writes roll back new tickets, replies and ticket timestamps',t=>{
  const {store,db,setNow}=setup(t);
  const {ticket}=store.receive(incoming());
  setNow(NOW+1000);
  db.exec("CREATE TRIGGER reject_inbox_insert BEFORE INSERT ON inbox_messages BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(()=>store.receive(incoming('guild-a','new-member','new-message')),/injected failure/);
  assert.throws(()=>store.prepareReply('guild-a',ticket.id,'admin','new-request','Private reply'),/injected failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_tickets').get()!.n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_messages').get()!.n,1);
  assert.equal(store.getTicket('guild-a',ticket.id)!.updatedAt,NOW);
  db.exec('DROP TRIGGER reject_inbox_insert');
  assert.equal(store.prepareReply('guild-a',ticket.id,'admin','new-request','Private reply').created,true);
});
