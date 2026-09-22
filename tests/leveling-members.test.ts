import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {LevelingSettingsStore} from '../server/leveling/settings.js';
import {LevelingMemberStore} from '../server/leveling/members.js';
import {LevelingMemberError} from '../shared/leveling-members.js';
import type {LevelingSettingsContent} from '../shared/leveling-settings.js';

const G='11111111111111111', H='22222222222222222', U='33333333333333333', V='44444444444444444';
const NOW=1_800_000_000_000, DAY=86_400_000;
function fixture(limits?:ConstructorParameters<typeof LevelingMemberStore>[3],path=':memory:',key=randomBytes(32).toString('base64')) {
  const vault=new Vault(key),base=new Store(path,vault);
  const settings=new LevelingSettingsStore(base.db,vault,(...args)=>base.addActivity(...args));
  const members=new LevelingMemberStore(base.db,vault,settings,limits);
  return {vault,base,settings,members,key};
}
function configure(f:ReturnType<typeof fixture>,patch:Partial<LevelingSettingsContent>,guildId=G) {
  const {revision,updatedAt:_updatedAt,...content}=f.settings.get(guildId);
  return f.settings.save(guildId,U,{...content,...patch,expectedRevision:revision,reason:'Fixture configuration change'});
}
function event(at:number,eventId='message_1',source:'message'|'reaction'|'voice'='message',guildId=G,memberId=U) {
  return {guildId,memberId,eventId,source,occurredAt:at,sourceCreatedAt:at};
}
const receiptCount=(f:ReturnType<typeof fixture>)=>(f.base.db.prepare('SELECT count(*) AS n FROM leveling_receipts').get() as {n:number}).n;
type MemberRow={guild_id:string;member_id:string;status:string;updated_at:number;expires_at:number|null;payload:string};
const memberContext=(r:MemberRow)=>`leveling-member:v1:${JSON.stringify([r.guild_id,r.member_id,r.status,r.updated_at,r.expires_at])}`;

test('awards require explicit current enrollment and read saved enabled/XP settings atomically',()=>{
  const f=fixture();try{
    assert.equal(f.members.award(event(NOW),NOW).reason,'not_active');
    assert.equal(f.members.get(G,U,NOW),null);
    assert.equal(f.members.join(G,U,NOW).totalXp,'0');
    configure(f,{enabled:false});
    assert.equal(f.members.award(event(NOW),NOW).reason,'disabled');
    assert.equal(receiptCount(f),0);
    configure(f,{enabled:true,xpPerAward:17});
    const awarded=f.members.award(event(NOW),NOW);
    assert.equal(awarded.awarded,true);assert.equal(awarded.member?.totalXp,'17');
    assert.equal(f.members.get(G,U,NOW)?.lastAwardAt,NOW);
    assert.equal(f.members.join(G,U,NOW+1).totalXp,'17');
    assert.equal(f.members.optIn(G,U,NOW+2).totalXp,'17');
  }finally{f.base.close();}
});

test('all sources share the exact cooldown boundary and rejected cooldown events cannot be replayed',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    assert.equal(f.members.award(event(NOW),NOW).reason,'awarded');
    const reaction=event(NOW+1,'message_2:reactor_1','reaction');
    assert.equal(f.members.award(reaction,NOW+1).reason,'cooldown');
    assert.equal(f.members.award(event(NOW+29_999,'voice_1','voice'),NOW+29_999).reason,'cooldown');
    assert.equal(f.members.award(event(NOW+30_000,'voice_2','voice'),NOW+30_000).reason,'awarded');
    assert.equal(f.members.award({...reaction,occurredAt:NOW+60_000},NOW+60_000).reason,'duplicate');
    assert.equal(f.members.get(G,U,NOW+60_000)?.totalXp,'20');
  }finally{f.base.close();}
});

test('there is no daily cap and members/servers have independent totals and cooldowns',()=>{
  const f=fixture();try{
    configure(f,{cooldownSeconds:1});
    f.members.join(G,U,NOW);f.members.join(G,V,NOW);f.members.join(H,U,NOW);
    for(let n=0;n<121;n++)assert.equal(f.members.award(event(NOW+n*1000,`message_${n}`),NOW+n*1000).awarded,true);
    assert.equal(f.members.get(G,U,NOW+120_000)?.totalXp,'1210');
    assert.equal(f.members.award(event(NOW,'different_message','message',G,V),NOW).member?.totalXp,'10');
    assert.equal(f.members.award(event(NOW,'message_0','message',H,U),NOW).member?.totalXp,'10');
  }finally{f.base.close();}
});

test('event identity cannot be replayed to another recipient or another store connection',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);f.members.join(G,V,NOW);
    f.members.award(event(NOW),NOW);
    const another=new LevelingMemberStore(f.base.db,f.vault,f.settings);
    assert.equal(another.award(event(NOW,'message_1','message',G,V),NOW).reason,'duplicate');
    assert.equal(another.get(G,V,NOW)?.totalXp,'0');
    assert.equal(receiptCount(f),1);
  }finally{f.base.close();}
});

test('expired, future, or pre-enrollment events cannot earn and old reaction sources stay ineligible after pruning',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    assert.equal(f.members.award(event(NOW-1),NOW).reason,'expired');
    assert.equal(f.members.award(event(NOW),NOW+300_000).reason,'expired');
    assert.equal(f.members.award({...event(NOW,'old','reaction'),sourceCreatedAt:NOW-30*DAY},NOW).reason,'expired');
    f.members.prune(NOW+DAY);
    assert.equal(f.members.award({...event(NOW+DAY,'old','reaction'),sourceCreatedAt:NOW-30*DAY},NOW+DAY).reason,'expired');
    assert.equal(f.members.award(event(NOW+1),NOW).reason,'expired');
    assert.equal(f.members.get(G,U,NOW+DAY)?.totalXp,'0');assert.equal(receiptCount(f),0);
  }finally{f.base.close();}
});

test('reaction receipts last through the source message window and survive opt-out/in without retaining XP',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    const reaction={...event(NOW,'source_message:reactor','reaction'),sourceCreatedAt:NOW-29*DAY};
    assert.equal(f.members.award(reaction,NOW).awarded,true);
    const opted=f.members.optOut(G,U,NOW+1);
    assert.equal(opted.status,'opted_out');
    for(const field of ['totalXp','lastAwardAt','joinedAt','leftAt','expiresAt'] as const)assert.equal(opted[field],null);
    assert.equal(f.members.join(G,U,NOW+2).status,'opted_out');
    assert.equal(f.members.award(event(NOW+3,'new'),NOW+3).reason,'not_active');
    assert.equal(receiptCount(f),1);
    assert.equal(f.members.optIn(G,U,NOW+4).totalXp,'0');
    assert.equal(f.members.award({...reaction,occurredAt:NOW+5},NOW+5).reason,'duplicate');
    assert.equal(f.members.award(event(NOW+6,'new_after_optin'),NOW+6).member?.totalXp,'10');
    f.members.prune(NOW+DAY);
    assert.equal(f.members.award({...reaction,occurredAt:NOW+DAY},NOW+DAY).reason,'expired');
  }finally{f.base.close();}
});

test('leaving is idempotent, blocks earning, and restores progress only before exact 30-day expiry',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);f.members.award(event(NOW),NOW);
    const left=f.members.leave(G,U,NOW+1)!;
    assert.equal(left.status,'departed');assert.equal(left.expiresAt,NOW+1+30*DAY);
    assert.equal(f.members.leave(G,U,NOW+100)?.expiresAt,left.expiresAt);
    assert.equal(f.members.award(event(NOW+100,'after_leave'),NOW+100).reason,'not_active');
    const returned=f.members.join(G,U,left.expiresAt!-1);
    assert.equal(returned.totalXp,'10');assert.equal(returned.lastAwardAt,NOW);
    assert.equal(returned.joinedAt,left.expiresAt!-1);
    const second=f.members.leave(G,U,left.expiresAt!)!;
    assert.equal(f.members.get(G,U,second.expiresAt!-1)?.totalXp,'10');
    assert.equal(f.members.get(G,U,second.expiresAt!),null);
    assert.equal(f.members.award(event(second.expiresAt!,'after_expiry'),second.expiresAt!).reason,'not_active');
    assert.equal(f.members.join(G,U,second.expiresAt!).totalXp,'0');
  }finally{f.base.close();}
});

test('cleanup removes departed progress and expired receipts but preserves opt-out preferences',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);f.members.award(event(NOW),NOW);f.members.leave(G,U,NOW+1);
    f.members.optOut(G,V,NOW);f.members.leave(G,V,NOW+1);
    f.members.prune(NOW+30*DAY+1);
    assert.equal(f.members.get(G,U,NOW+30*DAY+1),null);
    assert.equal(f.members.get(G,V,NOW+30*DAY+1)?.status,'opted_out');
    assert.equal(receiptCount(f),0);
    assert.equal((f.base.db.prepare('SELECT count(*) AS n FROM leveling_members').get() as {n:number}).n,1);
    assert.equal(f.members.join(G,V,NOW+40*DAY).status,'opted_out');
  }finally{f.base.close();}
});

test('storage limits fail closed without deleting live records or blocking existing-member opt-out',()=>{
  const f=fixture({membersPerGuild:1,membersGlobal:2,receiptsPerGuild:1,receiptsGlobal:2});try{
    f.members.join(G,U,NOW);f.members.join(H,U,NOW);
    assert.throws(()=>f.members.join(G,V,NOW), (e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===429);
    assert.throws(()=>f.members.join('55555555555555555',U,NOW), (e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===429);
    f.members.award(event(NOW),NOW);
    assert.equal(f.members.award(event(NOW+30_000,'second'),NOW+30_000).reason,'capacity');
    assert.equal(f.members.get(G,U,NOW+30_000)?.totalXp,'10');
    assert.equal(f.members.optOut(G,U,NOW+30_001).status,'opted_out');
    assert.equal(receiptCount(f),1);
    f.members.prune(NOW+DAY);
    f.members.optIn(G,U,NOW+DAY);
    assert.equal(f.members.award(event(NOW+DAY,'third'),NOW+DAY).reason,'awarded');
  }finally{f.base.close();}
});

test('global receipt capacity cannot be bypassed by switching servers',()=>{
  const f=fixture({receiptsPerGuild:2,receiptsGlobal:1});try{
    f.members.join(G,U,NOW);f.members.join(H,U,NOW);
    assert.equal(f.members.award(event(NOW),NOW).reason,'awarded');
    assert.equal(f.members.award(event(NOW,'other','message',H,U),NOW).reason,'capacity');
    assert.equal(f.members.get(H,U,NOW)?.totalXp,'0');assert.equal(receiptCount(f),1);
  }finally{f.base.close();}
});

test('failed encrypted writes roll back XP and receipt reservation together',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    const original=f.vault.seal.bind(f.vault);
    for(const failAt of [1,2]){
      let writes=0;
      f.vault.seal=(value,context)=>{if(++writes===failAt)throw new Error('Simulated encryption failure');return original(value,context);};
      assert.throws(()=>f.members.award(event(NOW),NOW));
      f.vault.seal=original;
      assert.equal(f.members.get(G,U,NOW)?.totalXp,'0');assert.equal(receiptCount(f),0);
    }
    assert.equal(f.members.award(event(NOW),NOW).member?.totalXp,'10');
  }finally{f.base.close();}
});

test('stored XP stays exact beyond Number precision when another award is added',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    const row=f.base.db.prepare('SELECT * FROM leveling_members').get() as MemberRow;
    const payload=f.vault.open<Record<string,unknown>>(row.payload,memberContext(row));
    const total=10n**100n+9_007_199_254_740_993n;
    f.base.db.prepare('UPDATE leveling_members SET payload=?').run(f.vault.seal({...payload,totalXp:total.toString()},memberContext(row)));
    assert.equal(f.members.get(G,U,NOW)?.totalXp,total.toString());
    assert.equal(f.members.award(event(NOW),NOW).member?.totalXp,(total+10n).toString());
  }finally{f.base.close();}
});

test('substituted member metadata or invalid authenticated totals fail closed instead of resetting XP',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);
    const original=f.base.db.prepare('SELECT * FROM leveling_members').get() as MemberRow;
    const content=f.vault.open<Record<string,unknown>>(original.payload,memberContext(original));
    const variants=[
      {...original,guild_id:H},{...original,member_id:V},{...original,updated_at:NOW+1},
      {...original,payload:'invalid encrypted data'},
      ...['-1','01','9'.repeat(4097),9_007_199_254_740_992].map(totalXp=>({...original,
        payload:f.vault.seal({...content,totalXp},memberContext(original))})),
    ];
    for(const row of variants){
      f.base.db.prepare('DELETE FROM leveling_members').run();
      f.base.db.prepare('INSERT INTO leveling_members(guild_id,member_id,status,updated_at,expires_at,payload) VALUES(?,?,?,?,?,?)')
        .run(row.guild_id,row.member_id,row.status,row.updated_at,row.expires_at,row.payload);
      assert.throws(()=>f.members.get(row.guild_id,row.member_id,NOW+1),(e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===500);
      assert.throws(()=>f.members.join(row.guild_id,row.member_id,NOW+1),(e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===500);
      assert.equal(receiptCount(f),0);
    }
  }finally{f.base.close();}
});

test('identities, malformed events and clock regression cannot mutate member progress',()=>{
  const f=fixture();try{
    for(const id of ['', '1', '1'.repeat(21),'1234567890123456x']) {
      assert.throws(()=>f.members.join(id,U,NOW));assert.throws(()=>f.members.optOut(G,id,NOW));
      assert.throws(()=>f.members.get(id,U,NOW));assert.throws(()=>f.members.removeGuild(id));
    }
    f.members.join(G,U,NOW);f.members.award(event(NOW),NOW);
    for(const patch of [{source:'poll'},{eventId:'body with spaces'},{eventId:'x'.repeat(161)},{occurredAt:NaN},{sourceCreatedAt:-1},{sourceCreatedAt:NOW-1},{content:'Message bodies are forbidden'}]) {
      assert.throws(()=>f.members.award({...event(NOW+30_000),...patch} as ReturnType<typeof event>,NOW+30_000));
    }
    for(const operation of [()=>f.members.join(G,U,NOW-1),()=>f.members.leave(G,U,NOW-1),()=>f.members.optOut(G,U,NOW-1),()=>f.members.optIn(G,U,NOW-1)])assert.throws(operation);
    assert.throws(()=>f.members.award(event(NOW-1,'regressed'),NOW-1),(e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===409);
    for(const now of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>f.members.prune(now));
    assert.equal(f.members.get(G,U,NOW)?.totalXp,'10');assert.equal(receiptCount(f),1);
  }finally{f.base.close();}
});

test('expiry tampering cannot silently hide or prune member progress and duplicate receipts',()=>{
  const f=fixture();try{
    f.members.join(G,U,NOW);f.members.award(event(NOW),NOW);f.members.leave(G,U,NOW+1);
    f.base.db.prepare('UPDATE leveling_members SET expires_at=?').run(NOW+2);
    assert.throws(()=>f.members.get(G,U,NOW+2),(e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===500);
    assert.throws(()=>f.members.prune(NOW+2));
    assert.equal((f.base.db.prepare('SELECT count(*) AS n FROM leveling_members').get() as {n:number}).n,1);
    f.base.db.prepare('UPDATE leveling_members SET expires_at=?').run(NOW+1+30*DAY);
    f.base.db.prepare('UPDATE leveling_receipts SET expires_at=?').run(NOW+2);
    assert.throws(()=>f.members.prune(NOW+2),(e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===500);
    assert.equal(receiptCount(f),1);
    assert.equal(f.members.get(G,U,NOW+2)?.totalXp,'10');
  }finally{f.base.close();}
});

test('disk reopen preserves totals and deduplication; wrong keys fail closed and guild deletion stays isolated',()=>{
  const dir=mkdtempSync(join(tmpdir(),'discord-leveling-members-'));
  let base:Store|undefined;
  try{
    const original=fixture(undefined,join(dir,'test.sqlite'));base=original.base;
    original.members.join(G,U,NOW);original.members.join(H,U,NOW);
    original.members.award(event(NOW),NOW);original.members.award(event(NOW,'message_1','message',H,U),NOW);
    const raw=base.db.prepare('SELECT payload FROM leveling_members WHERE guild_id=?').get(G) as {payload:string};
    assert.equal(raw.payload.includes('totalXp'),false);
    base.close();base=undefined;
    const f=fixture(undefined,join(dir,'test.sqlite'),original.key);base=f.base;
    assert.equal(f.members.get(G,U,NOW)?.totalXp,'10');
    assert.equal(f.members.award(event(NOW),NOW+30_000).reason,'duplicate');
    const wrong=new LevelingMemberStore(base.db,new Vault(randomBytes(32).toString('base64')),f.settings);
    assert.throws(()=>wrong.get(G,U,NOW), (e:unknown)=>e instanceof LevelingMemberError&&e.statusCode===500);
    f.members.removeGuild(G);
    assert.equal(f.members.get(G,U,NOW),null);assert.equal(f.members.get(H,U,NOW)?.totalXp,'10');
    assert.equal(receiptCount(f),1);
  }finally{base?.close();rmSync(dir,{recursive:true,force:true});}
});
