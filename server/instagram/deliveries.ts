import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import {tokenHash,type Vault} from '../crypto.js';
import {InstagramError} from '../../shared/instagram.js';
import {normalizeInstagramLink} from './links.js';

export const INSTAGRAM_DELIVERY_RETENTION_MS=90*86_400_000;
export const INSTAGRAM_SOURCE_MAX_AGE_MS=5*60_000;
export const INSTAGRAM_MAX_GUILD_DELIVERIES=1000;
export const INSTAGRAM_MAX_DELIVERIES=10000;
const id=z.string().regex(/^[1-9]\d{16,19}$/).refine(value=>BigInt(value)<=0xffffffffffffffffn);
const payloadSchema=z.object({
  sourceMessageId:id,sourceChannelId:id,destinationChannelId:id,authorId:id,
  settingsRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  url:z.string().max(2048).refine(value=>normalizeInstagramLink(value)!==null),
  embedTitle:z.string().trim().min(1).max(100),embedDescription:z.string().trim().max(2000),
  embedColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value=>value.toUpperCase()),
}).strict().refine(value=>value.sourceChannelId!==value.destinationChannelId);
export type InstagramDeliveryPayload=z.infer<typeof payloadSchema>;
export type InstagramDeliveryStatus='pending'|'sent'|'failed'|'uncertain';
export type InstagramDelivery={jobId:string;payload:InstagramDeliveryPayload;createdAt:number;status:InstagramDeliveryStatus;messageId:string|null};
type Row={guild_id:string;job_id:string;payload:string;created_at:number;status:InstagramDeliveryStatus;message_id:string|null};
function context(guildId:string,jobId:string,createdAt:number){return `instagram-delivery:v1:${JSON.stringify([guildId,jobId,createdAt])}`;}

/** Durable outgoing reservations keep gateway replays from creating a second POST. */
export class InstagramDeliveryStore {
  constructor(private readonly db:DatabaseSync,private readonly vault:Vault){
    db.exec(`CREATE TABLE IF NOT EXISTS instagram_deliveries(
      guild_id TEXT NOT NULL,job_id TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','uncertain')),message_id TEXT,
      PRIMARY KEY(guild_id,job_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS instagram_deliveries_expiry ON instagram_deliveries(created_at);
    CREATE INDEX IF NOT EXISTS instagram_deliveries_listing ON instagram_deliveries(guild_id,created_at DESC);`);
  }
  private decode(row:Row):InstagramDelivery {
    try{return {jobId:row.job_id,payload:payloadSchema.parse(this.vault.open(row.payload,context(row.guild_id,row.job_id,row.created_at))),createdAt:row.created_at,status:row.status,messageId:row.message_id};}
    catch{throw new InstagramError(500,'This Instagram delivery could not be read securely.');}
  }
  get(guildId:string,jobId:string,now=Date.now()):InstagramDelivery|null {
    const row=this.db.prepare('SELECT * FROM instagram_deliveries WHERE guild_id=? AND job_id=? AND created_at>?').get(guildId,jobId,now-INSTAGRAM_DELIVERY_RETENTION_MS) as Row|undefined;
    return row?this.decode(row):null;
  }
  list(guildId:string,now=Date.now()):InstagramDelivery[]{
    return (this.db.prepare('SELECT * FROM instagram_deliveries WHERE guild_id=? AND created_at>? ORDER BY created_at DESC,job_id LIMIT 100').all(guildId,now-INSTAGRAM_DELIVERY_RETENTION_MS) as Row[]).map(row=>this.decode(row));
  }
  reserve(guildId:string,input:InstagramDeliveryPayload,now=Date.now()):{created:boolean;record:InstagramDelivery}{
    id.parse(guildId);const payload=payloadSchema.parse(input);
    const sourceTime=Number((BigInt(payload.sourceMessageId)>>22n)+1420070400000n);
    if(sourceTime<=now-INSTAGRAM_SOURCE_MAX_AGE_MS || sourceTime>now+60_000)throw new InstagramError(400,'This source message is outside the announcement time window.');
    const link=normalizeInstagramLink(payload.url)!;payload.url=link.url;
    const jobId=tokenHash(JSON.stringify([guildId,payload.sourceMessageId,link.shortcode]));
    this.db.exec('BEGIN IMMEDIATE');
    try{
      // A replay keeps the originally reserved destination and payload, regardless of newer settings.
      const existing=this.get(guildId,jobId,now);
      if(existing){this.db.exec('COMMIT');return {created:false,record:existing};}
      // Never evict a retained job to make room; that could erase duplicate protection.
      const count=this.db.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(guild_id=?),0) AS guild FROM instagram_deliveries').get(guildId) as {total:number;guild:number};
      if(count.total>=INSTAGRAM_MAX_DELIVERIES || count.guild>=INSTAGRAM_MAX_GUILD_DELIVERIES)throw new InstagramError(429,'Instagram delivery storage is full. No new announcement was reserved.');
      this.db.prepare("INSERT INTO instagram_deliveries VALUES(?,?,?,?,'pending',NULL)")
        .run(guildId,jobId,this.vault.seal(payload,context(guildId,jobId,now)),now);
      this.db.exec('COMMIT');
      return {created:true,record:{jobId,payload,createdAt:now,status:'pending',messageId:null}};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  finish(guildId:string,jobId:string,status:Exclude<InstagramDeliveryStatus,'pending'>,messageId:string|null=null):InstagramDelivery{
    z.enum(['sent','failed','uncertain']).parse(status);
    if(status==='sent')id.parse(messageId);else if(messageId!==null)throw new InstagramError(400,'Only confirmed delivery can have a message ID.');
    // Authenticate the record before mutating it. Terminal states cannot be reset to pending.
    const current=this.get(guildId,jobId);if(!current)throw new InstagramError(404,'This Instagram delivery was not found.');
    this.db.prepare("UPDATE instagram_deliveries SET status=?,message_id=? WHERE guild_id=? AND job_id=? AND status='pending'").run(status,messageId,guildId,jobId);
    return this.get(guildId,jobId)!;
  }
  recover(){this.db.exec("UPDATE instagram_deliveries SET status='uncertain' WHERE status='pending';");}
  prune(now=Date.now()){this.db.prepare('DELETE FROM instagram_deliveries WHERE created_at<=?').run(now-INSTAGRAM_DELIVERY_RETENTION_MS);}
  removeGuild(guildId:string){this.db.prepare('DELETE FROM instagram_deliveries WHERE guild_id=?').run(guildId);}
}
