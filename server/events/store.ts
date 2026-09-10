import type { DatabaseSync } from 'node:sqlite';
import { EventError, type EventDraft, type EventRecord, type SavedEventDraft } from '../../shared/events.js';
import { Vault } from '../crypto.js';
import { savedDraftSchema } from './validation.js';

const RETENTION=90*86_400_000;
type Row={guild_id:string;request_id:string;actor_id:string;signature:string;payload:string;created_at:number;
  event_id:string|null;announcement_message_id:string|null;event_status:EventRecord['eventStatus'];announcement_status:EventRecord['announcementStatus']};
export type StoredEvent=EventRecord & {signature:string};
export function savedDraft(draft:EventDraft):SavedEventDraft {
  const {graphic,...fields}=draft;return {...fields,graphicAlt:graphic?.alt??null};
}
function context(guildId:string,requestId:string,actorId:string,createdAt:number) {return `event-job:${JSON.stringify([guildId,requestId,actorId,createdAt])}`;}
export function publicEvent(record:StoredEvent):EventRecord {const {signature:_,...result}=record;return result;}

export class EventStore {
  constructor(private readonly db:DatabaseSync,private readonly vault:Vault) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_jobs(
      guild_id TEXT NOT NULL,request_id TEXT NOT NULL,actor_id TEXT NOT NULL,signature TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,
      event_id TEXT,announcement_message_id TEXT,
      event_status TEXT NOT NULL CHECK(event_status IN ('pending','created','failed','uncertain')),
      announcement_status TEXT NOT NULL CHECK(announcement_status IN ('not_started','pending','sent','failed','uncertain')),
      PRIMARY KEY(guild_id,request_id)) STRICT;
      CREATE INDEX IF NOT EXISTS event_jobs_expiry ON event_jobs(created_at);
      CREATE INDEX IF NOT EXISTS event_jobs_listing ON event_jobs(guild_id,created_at DESC);`);
  }
  private decode(row:Row):StoredEvent {
    try {
      return {requestId:row.request_id,actorId:row.actor_id,signature:row.signature,createdAt:row.created_at,
        draft:savedDraftSchema.parse(this.vault.open(row.payload,context(row.guild_id,row.request_id,row.actor_id,row.created_at))),
        eventId:row.event_id,announcementMessageId:row.announcement_message_id,eventStatus:row.event_status,announcementStatus:row.announcement_status};
    }catch{throw new EventError(500,'This event record could not be read securely.');}
  }
  get(guildId:string,requestId:string):StoredEvent|null {
    const row=this.db.prepare('SELECT * FROM event_jobs WHERE guild_id=? AND request_id=? AND created_at>?').get(guildId,requestId,Date.now()-RETENTION) as Row|undefined;
    return row?this.decode(row):null;
  }
  require(guildId:string,requestId:string):StoredEvent {
    const record=this.get(guildId,requestId);if(!record)throw new EventError(404,'This event request was not found.');return record;
  }
  list(guildId:string):EventRecord[] {
    return (this.db.prepare('SELECT * FROM event_jobs WHERE guild_id=? AND created_at>? ORDER BY created_at DESC,request_id LIMIT 100').all(guildId,Date.now()-RETENTION) as Row[]).map(row=>publicEvent(this.decode(row)));
  }
  reserve(guildId:string,actorId:string,requestId:string,signature:string,draft:EventDraft):{created:boolean;record:StoredEvent} {
    const now=Date.now();
    const payload=this.vault.seal(savedDraft(draft),context(guildId,requestId,actorId,now));
    const result=this.db.prepare("INSERT INTO event_jobs VALUES(?,?,?,?,?,?,NULL,NULL,'pending','not_started') ON CONFLICT(guild_id,request_id) DO NOTHING").run(guildId,requestId,actorId,signature,payload,now);
    return {created:result.changes===1,record:this.require(guildId,requestId)};
  }
  eventResult(guildId:string,requestId:string,status:'created'|'failed'|'uncertain',eventId:string|null=null) {
    this.db.prepare("UPDATE event_jobs SET event_status=?,event_id=? WHERE guild_id=? AND request_id=? AND event_status='pending'").run(status,eventId,guildId,requestId);
    return this.require(guildId,requestId);
  }
  beginAnnouncement(guildId:string,requestId:string) {
    const result=this.db.prepare("UPDATE event_jobs SET announcement_status='pending' WHERE guild_id=? AND request_id=? AND event_status='created' AND announcement_status IN ('not_started','failed') AND created_at>?").run(guildId,requestId,Date.now()-RETENTION);
    return result.changes===1;
  }
  announcementResult(guildId:string,requestId:string,status:'sent'|'failed'|'uncertain',messageId:string|null=null) {
    this.db.prepare("UPDATE event_jobs SET announcement_status=?,announcement_message_id=? WHERE guild_id=? AND request_id=? AND announcement_status='pending'").run(status,messageId,guildId,requestId);
    return this.require(guildId,requestId);
  }
  recover() {this.db.exec("UPDATE event_jobs SET event_status='uncertain' WHERE event_status='pending'; UPDATE event_jobs SET announcement_status='uncertain' WHERE announcement_status='pending';");}
  prune(now=Date.now()) {this.db.prepare('DELETE FROM event_jobs WHERE created_at<=?').run(now-RETENTION);}
  removeGuild(guildId:string) {this.db.prepare('DELETE FROM event_jobs WHERE guild_id=?').run(guildId);}
}
