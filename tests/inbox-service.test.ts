import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {InboxStore} from '../server/inbox/store.js';
import {InboxService} from '../server/inbox/service.js';
import {InboxError} from '../shared/inbox.js';
import {BotSendError} from '../server/bot/types.js';
import type {InboxTransport} from '../server/inbox/types.js';
import {readConfig} from '../server/config.js';
import {buildApp} from '../server/app.js';
import type {DiscordApi} from '../server/discord.js';

const ga='11111111111111111',gb='22222222222222222',member='33333333333333333',admin='44444444444444444',role='55555555555555555';
function fixture(){
  const key=randomBytes(32).toString('base64'),vault=new Vault(key),store=new Store(':memory:',vault),persistence=new InboxStore(store.db,vault);
  let sends=0;
  const transport:InboxTransport={eligibleGuilds:async(_user,ids)=>ids.map(id=>({id,name:id===ga?'Server A':'Server B'})),verifyMember:async(id)=>({id,name:id===ga?'Server A':'Server B'}),sendReply:async()=>{sends++;return{id:'77777777777777777'};}};
  const service=new InboxService(persistence,transport,(...args)=>store.addActivity(...args));
  const incoming=()=>({memberId:member,discordMessageId:randomUUID(),content:'Confidential support request',attachments:[],createdAt:Date.now()});
  return {key,store,persistence,transport,service,incoming,sends:()=>sends};
}
test('a DM is not stored until the member explicitly selects an enabled server',async()=>{
  const f=fixture();try{
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    f.service.configure(ga,admin,true);f.service.configure(gb,admin,true);
    const choices=await f.service.choices(member);assert.equal(choices.guilds.length,2);
    await f.service.choose(choices.token,member,gb);
    const received=await f.service.receive(f.incoming());assert.equal(received.routed,true);
    assert.equal(f.persistence.listTickets(ga,'open').tickets.length,0);
    assert.equal(f.persistence.listTickets(gb,'open').tickets.length,1);
    await assert.rejects(f.service.choose(choices.token,member,ga),InboxError);
  }finally{f.store.close();}
});
test('disabled intake and revoked membership stop routing without storing the new DM',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    f.service.configure(ga,admin,false);assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    f.transport.verifyMember=async()=>{throw Error('Member removed');};
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    assert.equal(f.persistence.listTickets(ga,'open').tickets.length,0);
  }finally{f.store.close();}
});
test('disabling the inbox during membership verification cannot establish a route or store a DM',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);
    const verify=f.transport.verifyMember;
    f.transport.verifyMember=async(id,userId)=>{
      const guild=await verify(id,userId);
      f.service.configure(ga,admin,false);
      return guild;
    };
    await assert.rejects(f.service.contact(ga,member),error=>error instanceof InboxError && error.statusCode===409);
    assert.equal(f.persistence.getRoute(member),null);
    f.transport.verifyMember=verify;
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    f.transport.verifyMember=async(id,userId)=>{
      const guild=await verify(id,userId);
      f.service.configure(ga,admin,false);
      return guild;
    };
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    assert.equal(f.persistence.listTickets(ga,'open').tickets.length,0);
  }finally{f.store.close();}
});
test('a changed or expired route during membership lookup cannot forward the pending DM',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);f.service.configure(gb,admin,true);
    await f.service.contact(ga,member);
    f.transport.verifyMember=async(id)=>{
      f.persistence.setRoute(member,gb);
      return {id,name:'Server A'};
    };
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    assert.equal(f.persistence.listTickets(ga,'open').tickets.length,0);
    assert.equal(f.persistence.listTickets(gb,'open').tickets.length,0);
  }finally{f.store.close();}
});
test('switching servers clears the previous route and hostile chooser results are filtered',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    f.transport.eligibleGuilds=async()=>[{id:ga,name:'A'},{id:gb,name:'Unconfigured'}];
    const choices=await f.service.choices(member);
    assert.deepEqual(choices.guilds.map(g=>g.id),[ga]);assert.equal(f.persistence.getRoute(member),null);
  }finally{f.store.close();}
});
test('failed contact and expired selections never keep forwarding to the previous server',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    await assert.rejects(f.service.contact(gb,member),InboxError);
    assert.equal(f.persistence.getRoute(member),null);
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    await f.service.contact(ga,member);
    await assert.rejects(f.service.choose('expired-token',member,gb),InboxError);
    assert.equal(f.persistence.getRoute(member),null);
    assert.deepEqual(await f.service.receive(f.incoming()),{routed:false});
    assert.equal(f.persistence.listTickets(ga,'open').tickets.length,0);
  }finally{f.store.close();}
});
test('duplicate incoming events and reply retries are idempotent and activity contains no body',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    const input=f.incoming();const received=await f.service.receive(input);assert.ok(received.routed);
    assert.equal((await f.service.receive(input) as {created:boolean}).created,false);
    const requestId=randomUUID();
    const result=await Promise.all([f.service.reply(ga,received.ticketId,admin,requestId,'Private response'),f.service.reply(ga,received.ticketId,admin,requestId,'Private response')]);
    assert.ok(result.some(m=>m.status==='sent'));assert.equal(f.sends(),1);
    await assert.rejects(f.service.reply(ga,received.ticketId,admin,requestId,'Different response'),InboxError);
    assert.ok(!JSON.stringify(f.store.getActivity(ga)).includes('Private response'));
    assert.ok(!JSON.stringify(f.store.getActivity(ga)).includes(input.content));
  }finally{f.store.close();}
});
test('uncertain replies are never retried; known DM rejection is a failed reply',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    const received=await f.service.receive(f.incoming());assert.ok(received.routed);
    let calls=0;f.transport.sendReply=async()=>{calls++;throw Error('Timeout after POST');};
    const requestId=randomUUID();
    assert.equal((await f.service.reply(ga,received.ticketId,admin,requestId,'Response')).status,'uncertain');
    assert.equal((await f.service.reply(ga,received.ticketId,admin,requestId,'Response')).status,'uncertain');assert.equal(calls,1);
    f.transport.sendReply=async()=>{throw new BotSendError('DMs disabled',false);};
    assert.equal((await f.service.reply(ga,received.ticketId,admin,randomUUID(),'Another response')).status,'failed');
  }finally{f.store.close();}
});
test('closed or disabled conversations reject new replies but retain history',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    const received=await f.service.receive(f.incoming());assert.ok(received.routed);
    f.service.configure(ga,admin,false);
    await assert.rejects(f.service.reply(ga,received.ticketId,admin,randomUUID(),'Response'),InboxError);
    assert.equal(f.persistence.listMessages(ga,received.ticketId).messages.length,1);
    f.service.configure(ga,admin,true);f.service.close(ga,received.ticketId,admin);
    await assert.rejects(f.service.reply(ga,received.ticketId,admin,randomUUID(),'Response'),InboxError);
  }finally{f.store.close();}
});
test('disabling the inbox during reply preflight does not reserve or send the response',async()=>{
  const f=fixture();try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    const received=await f.service.receive(f.incoming());assert.ok(received.routed);
    f.transport.verifyMember=async(id)=>{
      f.service.configure(ga,admin,false);
      return {id,name:'Server A'};
    };
    const requestId=randomUUID();
    await assert.rejects(f.service.reply(ga,received.ticketId,admin,requestId,'Response'),
      error=>error instanceof InboxError && error.statusCode===409);
    assert.equal(f.persistence.getReply(ga,received.ticketId,requestId),null);
    assert.equal(f.sends(),0);
    assert.equal(f.persistence.listMessages(ga,received.ticketId).messages.length,1);
  }finally{f.store.close();}
});
test('HTTP inbox actions enforce current roles, both reply/read grants, CSRF, and tenant boundaries',async()=>{
  const f=fixture();
  const user={id:admin,username:'Test admin',avatar:null};
  const discord:DiscordApi={authorizeUrl:()=>'',exchange:async()=>({accessToken:'fixture',expiresIn:3600}),currentUser:async()=>user,userGuilds:async()=>[],revoke:async()=>{},guildContext:async guildId=>({guild:{id:guildId,name:'Test',icon:null,ownerId:'88888888888888888'},roles:[{id:guildId,name:'everyone',permissions:'0',position:0},{id:role,name:'admin',permissions:'8',position:10}],memberRoleIds:[role]})};
  const config=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:ga,DISCORD_CLIENT_SECRET:'test-secret',DISCORD_BOT_TOKEN:'test-token',DATA_ENCRYPTION_KEY:f.key});
  const app=await buildApp(config,f.store,discord,undefined,f.service);
  const session=f.store.createSession({user,accessToken:'fixture'},3600_000);
  const headers={cookie:`dm_session=${session.id}`,origin:config.APP_ORIGIN,'x-csrf-token':session.data.csrfToken};
  try{
    f.service.configure(ga,admin,true);await f.service.contact(ga,member);
    const received=await f.service.receive(f.incoming());assert.ok(received.routed);
    const url=`/api/guilds/${ga}/inbox/${received.ticketId}`;
    assert.equal((await app.inject({url,headers})).statusCode,403);
    f.store.setGrant(ga,role,['inbox.reply'],admin);
    assert.equal((await app.inject({method:'POST',url:`${url}/replies`,headers,payload:{requestId:randomUUID(),content:'Reply'}})).statusCode,403);
    f.store.setGrant(ga,role,['inbox.read','inbox.reply'],admin);
    assert.equal((await app.inject({url,headers})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:`${url}/close`,headers:{...headers,'x-csrf-token':'wrong'},payload:{}})).statusCode,403);
    f.store.setGrant(gb,role,['inbox.read'],admin);
    assert.equal((await app.inject({url:`/api/guilds/${gb}/inbox/${received.ticketId}`,headers})).statusCode,404);
    assert.equal((await app.inject({method:'PUT',url:`/api/guilds/${ga}/inbox/settings`,headers,payload:{enabled:false}})).statusCode,403);
  }finally{await app.close();f.store.close();}
});
