import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InboxError, type InboxAttachment, type InboxMessage, type InboxTicket } from '../../shared/inbox.js';
import { Vault, randomToken, tokenHash } from '../crypto.js';
import type { InboxPersistence } from './types.js';

const DAY = 86_400_000;
const RETENTION = 90 * DAY;
const attachmentSchema = z.object({
  id: z.string().min(1).max(128), name: z.string().min(1).max(256),
  url: z.url().max(4096), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const payloadSchema = z.object({ content: z.string().max(4000), attachments: z.array(attachmentSchema).max(10) }).strict();
type MessageRow = {
  id:string; seq:number; guild_id:string; ticket_id:string; direction:InboxMessage['direction'];
  actor_id:string; payload:string; status:InboxMessage['status']; discord_message_id:string|null;
  request_id:string|null; created_at:number;
};
const ticketColumns = 'id,member_id AS memberId,status,created_at AS createdAt,updated_at AS updatedAt';
type MessageIdentity = Pick<MessageRow,'guild_id'|'id'|'ticket_id'|'direction'|'actor_id'|'request_id'|'discord_message_id'|'created_at'>;
function messageContext(row:MessageIdentity):string {
  // Authenticate immutable routing metadata as well as the body, so ciphertext
  // cannot be reassigned to another member, conversation or retention date.
  return `inbox:message:${JSON.stringify([row.guild_id,row.id,row.ticket_id,row.direction,row.actor_id,row.request_id,
    row.direction==='incoming'?row.discord_message_id:null,row.created_at])}`;
}

export class InboxStore implements InboxPersistence {
  constructor(private readonly db: DatabaseSync, private readonly vault: Vault) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_settings(guild_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1))) STRICT;
      CREATE TABLE IF NOT EXISTS inbox_routes(user_id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS inbox_routes_guild ON inbox_routes(guild_id);
      CREATE TABLE IF NOT EXISTS inbox_choices(token_hash TEXT NOT NULL,user_id TEXT NOT NULL,guild_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(token_hash,guild_id)) STRICT;
      CREATE INDEX IF NOT EXISTS inbox_choices_guild ON inbox_choices(guild_id);
      CREATE TABLE IF NOT EXISTS inbox_tickets(guild_id TEXT NOT NULL,id TEXT NOT NULL,member_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','closed')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(guild_id,id)) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_one_open_ticket ON inbox_tickets(guild_id,member_id) WHERE status='open';
      CREATE INDEX IF NOT EXISTS inbox_ticket_listing ON inbox_tickets(guild_id,status,updated_at DESC,id);
      CREATE TABLE IF NOT EXISTS inbox_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),actor_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('received','pending','sent','failed','uncertain')),discord_message_id TEXT,request_id TEXT,created_at INTEGER NOT NULL,UNIQUE(guild_id,id),FOREIGN KEY(guild_id,ticket_id) REFERENCES inbox_tickets(guild_id,id) ON DELETE CASCADE) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_incoming_source ON inbox_messages(discord_message_id) WHERE direction='incoming';
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_reply_requests ON inbox_messages(guild_id,request_id) WHERE request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS inbox_message_listing ON inbox_messages(guild_id,ticket_id,seq DESC);
      CREATE INDEX IF NOT EXISTS inbox_message_retention ON inbox_messages(created_at);
    `);
  }

  private transaction<T>(operation:()=>T):T {
    this.db.exec('SAVEPOINT inbox_write');
    try { const result=operation(); this.db.exec('RELEASE SAVEPOINT inbox_write'); return result; }
    catch(error) { this.db.exec('ROLLBACK TO SAVEPOINT inbox_write; RELEASE SAVEPOINT inbox_write'); throw error; }
  }

  private message(row:MessageRow):InboxMessage {
    try {
      const payload=payloadSchema.parse(this.vault.open(row.payload,messageContext(row)));
      return {id:row.id,seq:row.seq,ticketId:row.ticket_id,direction:row.direction,actorId:row.actor_id,
        content:payload.content,attachments:payload.attachments,status:row.status,discordMessageId:row.discord_message_id,createdAt:row.created_at};
    } catch { throw new InboxError(500,'This inbox message could not be read securely.'); }
  }

  private row(guildId:string,id:string):MessageRow {
    const row=this.db.prepare('SELECT * FROM inbox_messages WHERE guild_id=? AND id=? AND created_at>?').get(guildId,id,Date.now()-RETENTION) as MessageRow|undefined;
    if(!row) throw new InboxError(404,'Inbox message not found.');
    return row;
  }

  getSettings(guildId:string) {
    const row=this.db.prepare('SELECT enabled FROM inbox_settings WHERE guild_id=?').get(guildId) as {enabled:number}|undefined;
    return {enabled:row?.enabled===1};
  }
  setSettings(guildId:string,enabled:boolean) {
    this.db.prepare('INSERT INTO inbox_settings VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled').run(guildId,enabled?1:0);
  }
  enabledGuildIds():string[] {
    return (this.db.prepare('SELECT guild_id FROM inbox_settings WHERE enabled=1 ORDER BY guild_id').all() as {guild_id:string}[]).map(row=>row.guild_id);
  }
  setRoute(userId:string,guildId:string,now=Date.now()) {
    this.db.prepare('INSERT INTO inbox_routes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET guild_id=excluded.guild_id,expires_at=excluded.expires_at').run(userId,guildId,now+DAY);
  }
  getRoute(userId:string,now=Date.now()):string|null {
    return (this.db.prepare('SELECT guild_id FROM inbox_routes WHERE user_id=? AND expires_at>?').get(userId,now) as {guild_id:string}|undefined)?.guild_id??null;
  }
  clearRoute(userId:string) { this.db.prepare('DELETE FROM inbox_routes WHERE user_id=?').run(userId); }
  createChoice(userId:string,guildIds:string[],now=Date.now()):string {
    const allowed=[...new Set(guildIds)];
    if(allowed.length<1 || allowed.length>25 || allowed.some(id=>typeof id!=='string' || !id.length || id.length>128)) {
      throw new InboxError(400,'Choose between one and 25 available servers.');
    }
    const token=randomToken();
    this.transaction(()=>{
      const insert=this.db.prepare('INSERT INTO inbox_choices VALUES(?,?,?,?)');
      for(const guildId of allowed) insert.run(tokenHash(token),userId,guildId,now+10*60_000);
    });
    return token;
  }
  consumeChoice(token:string,userId:string,guildId:string,now=Date.now()):boolean {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return this.transaction(()=>{
      const hash=tokenHash(token);
      const row=this.db.prepare('SELECT token_hash FROM inbox_choices WHERE token_hash=? AND user_id=? AND guild_id=? AND expires_at>?').get(hash,userId,guildId,now);
      if(!row) return false;
      this.db.prepare('DELETE FROM inbox_choices WHERE token_hash=? AND user_id=?').run(hash,userId);
      return true;
    });
  }

  receive(input:{guildId:string;memberId:string;discordMessageId:string;content:string;attachments:InboxAttachment[];createdAt:number}) {
    const now=Date.now();
    const payload=payloadSchema.safeParse({content:input.content,attachments:input.attachments});
    if(!payload.success || (!input.content.trim() && !input.attachments.length) || !Number.isSafeInteger(input.createdAt)) {
      throw new InboxError(400,'The inbox message is invalid or exceeds its size limit.');
    }
    const createdAt=Math.min(input.createdAt,now);
    if(createdAt<=now-RETENTION) throw new InboxError(400,'This message is outside the retention period.');
    return this.transaction(()=>{
      const duplicate=this.db.prepare("SELECT * FROM inbox_messages WHERE discord_message_id=? AND direction='incoming'").get(input.discordMessageId) as MessageRow|undefined;
      if(duplicate) {
        if(duplicate.guild_id!==input.guildId || duplicate.actor_id!==input.memberId) throw new InboxError(409,'This message is already associated with another staff conversation.');
        if(duplicate.created_at<=now-RETENTION) throw new InboxError(400,'This message is outside the retention period.');
        return {ticket:this.getTicket(input.guildId,duplicate.ticket_id)!,message:this.message(duplicate),created:false};
      }
      let ticket=this.db.prepare(`SELECT ${ticketColumns} FROM inbox_tickets WHERE guild_id=? AND member_id=? AND status='open'`).get(input.guildId,input.memberId) as InboxTicket|undefined;
      if(!ticket) {
        ticket={id:randomUUID(),memberId:input.memberId,status:'open',createdAt,updatedAt:now};
        this.db.prepare("INSERT INTO inbox_tickets VALUES(?,?,?,'open',?,?)").run(input.guildId,ticket.id,input.memberId,createdAt,now);
      }
      const id=randomUUID();
      const encrypted=this.vault.seal(payload.data,messageContext({guild_id:input.guildId,id,ticket_id:ticket.id,
        direction:'incoming',actor_id:input.memberId,request_id:null,discord_message_id:input.discordMessageId,created_at:createdAt}));
      this.db.prepare("INSERT INTO inbox_messages(guild_id,id,ticket_id,direction,actor_id,payload,status,discord_message_id,request_id,created_at) VALUES(?,?,?,'incoming',?,?,'received',?,NULL,?)").run(input.guildId,id,ticket.id,input.memberId,encrypted,input.discordMessageId,createdAt);
      this.db.prepare('UPDATE inbox_tickets SET updated_at=? WHERE guild_id=? AND id=?').run(now,input.guildId,ticket.id);
      return {ticket:{...ticket,updatedAt:now},message:this.message(this.row(input.guildId,id)),created:true};
    });
  }

  listTickets(guildId:string,status:'open'|'closed',offset=0) {
    if(!Number.isSafeInteger(offset) || offset<0 || (status!=='open' && status!=='closed')) throw new InboxError(400,'Invalid inbox page.');
    const rows=this.db.prepare(`SELECT ${ticketColumns} FROM inbox_tickets t WHERE guild_id=? AND status=? AND EXISTS(SELECT 1 FROM inbox_messages m WHERE m.guild_id=t.guild_id AND m.ticket_id=t.id AND m.created_at>?) ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?`).all(guildId,status,Date.now()-RETENTION,offset) as InboxTicket[];
    return {tickets:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null};
  }
  getTicket(guildId:string,ticketId:string):InboxTicket|null {
    return (this.db.prepare(`SELECT ${ticketColumns} FROM inbox_tickets t WHERE guild_id=? AND id=? AND EXISTS(SELECT 1 FROM inbox_messages m WHERE m.guild_id=t.guild_id AND m.ticket_id=t.id AND m.created_at>?)`).get(guildId,ticketId,Date.now()-RETENTION) as InboxTicket|undefined)??null;
  }
  listMessages(guildId:string,ticketId:string,before?:number) {
    if(before!==undefined && (!Number.isSafeInteger(before) || before<1)) throw new InboxError(400,'Invalid inbox page.');
    const rows=this.db.prepare('SELECT * FROM inbox_messages WHERE guild_id=? AND ticket_id=? AND created_at>? AND seq<? ORDER BY seq DESC LIMIT 101').all(guildId,ticketId,Date.now()-RETENTION,before??Number.MAX_SAFE_INTEGER) as MessageRow[];
    const page=rows.slice(0,100);
    return {messages:page.reverse().map(row=>this.message(row)),nextBefore:rows.length>100?page[0].seq:null};
  }

  prepareReply(guildId:string,ticketId:string,actorId:string,requestId:string,content:string) {
    if(typeof content!=='string' || !content.trim() || content.length>2000 || !requestId || requestId.length>128) throw new InboxError(400,'The reply is invalid or exceeds 2,000 characters.');
    return this.transaction(()=>{
      const prior=this.db.prepare('SELECT * FROM inbox_messages WHERE guild_id=? AND request_id=? AND created_at>?').get(guildId,requestId,Date.now()-RETENTION) as MessageRow|undefined;
      if(prior) {
        if(prior.ticket_id!==ticketId || prior.actor_id!==actorId) throw new InboxError(409,'This reply request was already used for a different reply.');
        const message=this.message(prior);
        // Compare content fingerprints without retaining a guessable plaintext hash.
        if(tokenHash(message.content)!==tokenHash(content)) throw new InboxError(409,'This reply request was already used for a different reply.');
        return {created:false,message};
      }
      const ticket=this.getTicket(guildId,ticketId);
      if(!ticket) throw new InboxError(404,'Inbox ticket not found.');
      if(ticket.status==='closed') throw new InboxError(409,'This inbox ticket is closed.');
      const now=Date.now(),id=randomUUID();
      this.db.prepare('DELETE FROM inbox_messages WHERE guild_id=? AND request_id=? AND created_at<=?').run(guildId,requestId,now-RETENTION);
      const payload=this.vault.seal({content,attachments:[]},messageContext({guild_id:guildId,id,ticket_id:ticketId,
        direction:'outgoing',actor_id:actorId,request_id:requestId,discord_message_id:null,created_at:now}));
      this.db.prepare("INSERT INTO inbox_messages(guild_id,id,ticket_id,direction,actor_id,payload,status,discord_message_id,request_id,created_at) VALUES(?,?,?,'outgoing',?,?,'pending',NULL,?,?)").run(guildId,id,ticketId,actorId,payload,requestId,now);
      this.db.prepare('UPDATE inbox_tickets SET updated_at=? WHERE guild_id=? AND id=?').run(now,guildId,ticketId);
      return {created:true,message:this.message(this.row(guildId,id))};
    });
  }
  getReply(guildId:string,ticketId:string,requestId:string):InboxMessage|null {
    const row=this.db.prepare("SELECT * FROM inbox_messages WHERE guild_id=? AND ticket_id=? AND request_id=? AND direction='outgoing' AND created_at>?").get(guildId,ticketId,requestId,Date.now()-RETENTION) as MessageRow|undefined;
    return row?this.message(row):null;
  }
  finishReply(guildId:string,ticketId:string,requestId:string,status:'sent'|'failed'|'uncertain',discordMessageId:string|null):InboxMessage {
    if(!['sent','failed','uncertain'].includes(status)) throw new InboxError(400,'Invalid reply status.');
    return this.transaction(()=>{
      const previous=this.getReply(guildId,ticketId,requestId);
      if(!previous) throw new InboxError(404,'Inbox reply not found.');
      if(previous.status==='sent') return previous;
      this.db.prepare('UPDATE inbox_messages SET status=?,discord_message_id=? WHERE guild_id=? AND ticket_id=? AND request_id=?').run(status,discordMessageId,guildId,ticketId,requestId);
      return this.getReply(guildId,ticketId,requestId)!;
    });
  }
  closeTicket(guildId:string,ticketId:string) {
    this.transaction(()=>{
      if(!this.getTicket(guildId,ticketId)) throw new InboxError(404,'Inbox ticket not found.');
      this.db.prepare("UPDATE inbox_tickets SET status='closed',updated_at=? WHERE guild_id=? AND id=?").run(Date.now(),guildId,ticketId);
    });
  }
  recoverPendingReplies() { this.db.prepare("UPDATE inbox_messages SET status='uncertain' WHERE direction='outgoing' AND status='pending'").run(); }
  prune(now=Date.now()) {
    this.transaction(()=>{
      this.db.prepare('DELETE FROM inbox_messages WHERE created_at<=?').run(now-RETENTION);
      this.db.prepare('DELETE FROM inbox_tickets AS t WHERE NOT EXISTS(SELECT 1 FROM inbox_messages m WHERE m.guild_id=t.guild_id AND m.ticket_id=t.id)').run();
      this.db.prepare('DELETE FROM inbox_choices WHERE expires_at<=?').run(now);
      this.db.prepare('DELETE FROM inbox_routes WHERE expires_at<=?').run(now);
    });
  }
  removeGuild(guildId:string) {
    this.transaction(()=>{
      for(const table of ['inbox_messages','inbox_tickets','inbox_choices','inbox_routes','inbox_settings']) this.db.prepare(`DELETE FROM ${table} WHERE guild_id=?`).run(guildId);
    });
  }
}
