import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import {tokenHash,type Vault} from '../crypto.js';
import {LevelingSettingsStore,levelingIdSchema} from './settings.js';
import {LevelingMemberError,type LevelingMember,type LevelingAward,type LevelingAwardResult} from '../../shared/leveling-members.js';

const DAY=86_400_000,RETENTION=30*DAY,FRESHNESS=300_000;
const time=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const clock=time.max(Number.MAX_SAFE_INTEGER-RETENTION);
const payloadSchema=z.object({
  totalXp:z.string().max(4096).regex(/^(0|[1-9]\d*)$/).nullable(),
  lastAwardAt:time.nullable(),joinedAt:time.nullable(),leftAt:time.nullable(),
}).strict();
const rowSchema=z.object({guild_id:levelingIdSchema,member_id:levelingIdSchema,
  status:z.enum(['active','departed','opted_out']),updated_at:clock,expires_at:time.nullable(),payload:z.string(),
}).strict();
const receiptSchema=z.object({guild_id:levelingIdSchema,member_id:levelingIdSchema,
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/),expires_at:time,payload:z.string(),
}).strict();
const awardSchema=z.object({guildId:levelingIdSchema,memberId:levelingIdSchema,
  source:z.enum(['message','reaction','voice']),eventId:z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/),
  occurredAt:clock,sourceCreatedAt:clock,
}).strict().refine(v=>v.sourceCreatedAt<=v.occurredAt && (v.source==='reaction'||v.sourceCreatedAt===v.occurredAt));
type Row=z.infer<typeof rowSchema>;
type Receipt=z.infer<typeof receiptSchema>;
type Limits={membersPerGuild:number;membersGlobal:number;receiptsPerGuild:number;receiptsGlobal:number};
const defaults:Limits={membersPerGuild:5000,membersGlobal:20000,receiptsPerGuild:20000,receiptsGlobal:100000};
const memberContext=(r:Omit<Row,'payload'>)=>`leveling-member:v1:${JSON.stringify([r.guild_id,r.member_id,r.status,r.updated_at,r.expires_at])}`;
const receiptContext=(r:Omit<Receipt,'payload'>)=>`leveling-receipt:v1:${JSON.stringify([r.guild_id,r.fingerprint,r.member_id,r.expires_at])}`;

/** Internal persistence only: callers must independently verify current Discord eligibility. */
export class LevelingMemberStore {
  private readonly limits:Limits;
  constructor(private readonly db:DatabaseSync,private readonly vault:Vault,
    private readonly settings:LevelingSettingsStore,limits:Partial<Limits>={}) {
    this.limits={...defaults,...limits};
    for(const key of Object.keys(this.limits) as (keyof Limits)[])
      z.number().int().min(1).max(defaults[key]).parse(this.limits[key]);
    db.exec(`CREATE TABLE IF NOT EXISTS leveling_members(
      guild_id TEXT NOT NULL,member_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','departed','opted_out')),
      updated_at INTEGER NOT NULL,expires_at INTEGER,payload TEXT NOT NULL,PRIMARY KEY(guild_id,member_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS leveling_members_expiry ON leveling_members(expires_at);
    CREATE TABLE IF NOT EXISTS leveling_receipts(
      guild_id TEXT NOT NULL,fingerprint TEXT NOT NULL,member_id TEXT NOT NULL,expires_at INTEGER NOT NULL,
      payload TEXT NOT NULL,PRIMARY KEY(guild_id,fingerprint)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS leveling_receipts_expiry ON leveling_receipts(expires_at);`);
  }
  private transaction<T>(run:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=run();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private validate(g:string,u:string,now:number){levelingIdSchema.parse(g);levelingIdSchema.parse(u);clock.parse(now);}
  private decode(value:unknown):{row:Row;member:LevelingMember} {
    try{
      const row=rowSchema.parse(value),p=payloadSchema.parse(this.vault.open(row.payload,memberContext(row)));
      const bad=row.status==='opted_out'
        ? p.totalXp!==null||p.lastAwardAt!==null||p.joinedAt!==null||p.leftAt!==null||row.expires_at!==null
        : p.totalXp===null||p.joinedAt===null||p.joinedAt>row.updated_at||
          (p.lastAwardAt!==null&&p.lastAwardAt>row.updated_at)||
          (row.status==='active'?(p.leftAt!==null||row.expires_at!==null):
            p.leftAt===null||p.leftAt<p.joinedAt||p.leftAt>row.updated_at||row.expires_at!==p.leftAt+RETENTION);
      if(bad)throw new Error('Invalid member state');
      return {row,member:{guildId:row.guild_id,memberId:row.member_id,status:row.status,...p,expiresAt:row.expires_at}};
    }catch{throw new LevelingMemberError(500,'This leveling member record could not be read securely.');}
  }
  private read(g:string,u:string){
    const row=this.db.prepare('SELECT * FROM leveling_members WHERE guild_id=? AND member_id=?').get(g,u);
    return row?this.decode(row):null;
  }
  private decodeReceipt(value:unknown):Receipt {
    try{
      const row=receiptSchema.parse(value);
      z.object({valid:z.literal(true)}).strict().parse(this.vault.open(row.payload,receiptContext(row)));
      return row;
    }catch{throw new LevelingMemberError(500,'This leveling duplicate record could not be read securely.');}
  }
  private checkTime(record:ReturnType<LevelingMemberStore['read']>,now:number){
    if(record&&now<record.row.updated_at)throw new LevelingMemberError(409,'The clock moved backwards. Retry after the current saved update time.');
  }
  private visible(record:ReturnType<LevelingMemberStore['read']>,now:number):LevelingMember|null {
    return record && (record.member.expiresAt===null||record.member.expiresAt>now)?record.member:null;
  }
  private write(member:LevelingMember,now:number):LevelingMember {
    const row={guild_id:member.guildId,member_id:member.memberId,status:member.status,updated_at:now,expires_at:member.expiresAt};
    const payload=payloadSchema.parse({totalXp:member.totalXp,lastAwardAt:member.lastAwardAt,joinedAt:member.joinedAt,leftAt:member.leftAt});
    this.db.prepare(`INSERT INTO leveling_members VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,member_id)
      DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,expires_at=excluded.expires_at,payload=excluded.payload`)
      .run(row.guild_id,row.member_id,row.status,row.updated_at,row.expires_at,this.vault.seal(payload,memberContext(row)));
    return {...member};
  }
  private full(table:'leveling_members'|'leveling_receipts',g:string,perGuild:number,global:number){
    const count=(sql:string,...args:(string|number)[])=>(this.db.prepare(sql).get(...args) as {n:number}).n;
    return count(`SELECT count(*) AS n FROM (SELECT 1 FROM ${table} WHERE guild_id=? LIMIT ?)`,g,perGuild)>=perGuild ||
      count(`SELECT count(*) AS n FROM (SELECT 1 FROM ${table} LIMIT ?)`,global)>=global;
  }
  private admission(g:string){
    if(this.full('leveling_members',g,this.limits.membersPerGuild,this.limits.membersGlobal))
      throw new LevelingMemberError(429,'Leveling member storage is full. Cleanup or a capacity review is needed.');
  }
  private active(g:string,u:string,now:number):LevelingMember {
    return {guildId:g,memberId:u,status:'active',totalXp:'0',lastAwardAt:null,joinedAt:now,leftAt:null,expiresAt:null};
  }
  get(g:string,u:string,now=Date.now()):LevelingMember|null {
    this.validate(g,u,now);return this.visible(this.read(g,u),now);
  }
  private enroll(g:string,u:string,now:number,explicitOptIn:boolean){
    const record=this.read(g,u);this.checkTime(record,now);
    if(record?.member.status==='active'||(record?.member.status==='opted_out'&&!explicitOptIn))return record.member;
    if(!record)this.admission(g);
    const old=this.visible(record,now);
    const member=old?.status==='departed'?{...old,status:'active' as const,joinedAt:now,leftAt:null,expiresAt:null}:this.active(g,u,now);
    return this.write(member,now);
  }
  join(g:string,u:string,now=Date.now()):LevelingMember {
    this.validate(g,u,now);return this.transaction(()=>this.enroll(g,u,now,false));
  }
  optIn(g:string,u:string,now=Date.now()):LevelingMember {
    this.validate(g,u,now);return this.transaction(()=>this.enroll(g,u,now,true));
  }
  leave(g:string,u:string,now=Date.now()):LevelingMember|null {
    this.validate(g,u,now);return this.transaction(()=>{
      const record=this.read(g,u);this.checkTime(record,now);const member=this.visible(record,now);
      if(!member||member.status!=='active')return member;
      return this.write({...member,status:'departed',leftAt:now,expiresAt:now+RETENTION},now);
    });
  }
  optOut(g:string,u:string,now=Date.now()):LevelingMember {
    this.validate(g,u,now);return this.transaction(()=>{
      const record=this.read(g,u);this.checkTime(record,now);if(!record)this.admission(g);
      return this.write({guildId:g,memberId:u,status:'opted_out',totalXp:null,lastAwardAt:null,joinedAt:null,leftAt:null,expiresAt:null},now);
    });
  }
  award(input:LevelingAward,now=Date.now()):LevelingAwardResult {
    const v=awardSchema.parse(input);clock.parse(now);
    return this.transaction(()=>{
      const record=this.read(v.guildId,v.memberId);this.checkTime(record,now);
      const member=this.visible(record,now);
      const result=(reason:LevelingAwardResult['reason'],m=member):LevelingAwardResult=>({awarded:reason==='awarded',reason,member:m});
      if(!member||member.status!=='active')return result('not_active');
      if(v.occurredAt>now||now-v.occurredAt>=FRESHNESS||v.occurredAt<member.joinedAt!||
        (v.source==='reaction'&&v.sourceCreatedAt+RETENTION<=now))return result('expired');
      const settings=this.settings.get(v.guildId);if(!settings.enabled)return result('disabled');
      const fingerprint=tokenHash(JSON.stringify([v.guildId,v.source,v.eventId]));
      const raw=this.db.prepare('SELECT * FROM leveling_receipts WHERE guild_id=? AND fingerprint=?').get(v.guildId,fingerprint);
      if(raw){this.decodeReceipt(raw);return result('duplicate');}
      if(this.full('leveling_receipts',v.guildId,this.limits.receiptsPerGuild,this.limits.receiptsGlobal))return result('capacity');
      const receipt={guild_id:v.guildId,member_id:v.memberId,fingerprint,expires_at:v.source==='reaction'?v.sourceCreatedAt+RETENTION:v.occurredAt+DAY};
      this.db.prepare('INSERT INTO leveling_receipts(guild_id,fingerprint,member_id,expires_at,payload) VALUES(?,?,?,?,?)')
        .run(receipt.guild_id,fingerprint,receipt.member_id,receipt.expires_at,this.vault.seal({valid:true},receiptContext(receipt)));
      if(member.lastAwardAt!==null&&now-member.lastAwardAt<settings.cooldownSeconds*1000)return result('cooldown');
      const totalXp=(BigInt(member.totalXp!)+BigInt(settings.xpPerAward)).toString();
      return result('awarded',this.write({...member,totalXp,lastAwardAt:now},now));
    });
  }
  prune(now=Date.now()):void {
    clock.parse(now);
    // Bounded batches avoid loading the entire receipt history into Pi memory.
    for(const table of ['leveling_members','leveling_receipts'] as const){
      let more=true;
      while(more)this.transaction(()=>{
        const rows=this.db.prepare(`SELECT * FROM ${table} WHERE expires_at<=? LIMIT 500`).all(now);
        for(const raw of rows){
          if(table==='leveling_members'){
            const {row}=this.decode(raw);
            this.db.prepare('DELETE FROM leveling_members WHERE guild_id=? AND member_id=?').run(row.guild_id,row.member_id);
          }else{
            const row=this.decodeReceipt(raw);
            this.db.prepare('DELETE FROM leveling_receipts WHERE guild_id=? AND fingerprint=?').run(row.guild_id,row.fingerprint);
          }
        }
        more=rows.length===500;
      });
    }
  }
  removeGuild(g:string):void {
    levelingIdSchema.parse(g);this.transaction(()=>{
      this.db.prepare('DELETE FROM leveling_receipts WHERE guild_id=?').run(g);
      this.db.prepare('DELETE FROM leveling_members WHERE guild_id=?').run(g);
    });
  }
}
