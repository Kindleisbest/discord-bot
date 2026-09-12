import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {InstagramError} from '../shared/instagram.js';
import {InstagramDeliveryStore,INSTAGRAM_SOURCE_MAX_AGE_MS,INSTAGRAM_DELIVERY_RETENTION_MS,INSTAGRAM_MAX_GUILD_DELIVERIES,INSTAGRAM_MAX_DELIVERIES,type InstagramDeliveryPayload} from '../server/instagram/deliveries.js';
const ga='11111111111111111',gb='22222222222222222',user='33333333333333333',source='44444444444444444',destination='55555555555555555';
function snowflake(time:number,increment=0){return (((BigInt(time)-1420070400000n)<<22n)+BigInt(increment)).toString();}
function input(patch:Partial<InstagramDeliveryPayload>={}):InstagramDeliveryPayload{return {sourceMessageId:snowflake(Date.now()),sourceChannelId:source,destinationChannelId:destination,authorId:user,settingsRevision:1,url:'https://instagram.com/p/AbC/?igsh=tracking',embedTitle:'Community post',embedDescription:'Private announcement wording',embedColor:'#aabbcc',...patch};}
function fixture(){const vault=new Vault(randomBytes(32).toString('base64')),base=new Store(':memory:',vault);return {vault,base,store:new InstagramDeliveryStore(base.db,vault)};}
test('first reservation wins across duplicate handlers and changed configuration without exposing tracking',()=>{
  const f=fixture();try{
    const payload=input(),first=f.store.reserve(ga,payload),other=new InstagramDeliveryStore(f.base.db,f.vault);
    const duplicate=other.reserve(ga,{...payload,url:'https://www.instagram.com/reel/AbC/',settingsRevision:2,destinationChannelId:user,embedTitle:'Changed'});
    assert.equal(first.created,true);assert.equal(duplicate.created,false);assert.deepEqual(duplicate.record,first.record);
    assert.equal(first.record.payload.url,'https://www.instagram.com/p/AbC/');assert.equal(first.record.payload.embedColor,'#AABBCC');
    assert.equal(f.store.reserve(ga,{...payload,url:'https://instagram.com/p/abc/'}).created,true);
    assert.equal(f.store.reserve(gb,payload).created,true);assert.equal(f.store.get(gb,first.record.jobId),null);
  }finally{f.base.close();}
});
test('delivery payload and routing metadata are encrypted and bound to their server, job, and timestamp',()=>{
  const f=fixture();try{
    const job=f.store.reserve(ga,input()).record;
    const raw=JSON.stringify(f.base.db.prepare('SELECT * FROM instagram_deliveries').all());
    for(const privateValue of [job.payload.url,job.payload.embedDescription,source,destination])assert.equal(raw.includes(privateValue),false);
    for(const [field,value] of [['guild_id',gb],['job_id','other'],['created_at',Date.now()+10]] as const){
      const previous=f.base.db.prepare(`SELECT ${field} AS value FROM instagram_deliveries`).get() as {value:string|number};
      f.base.db.prepare(`UPDATE instagram_deliveries SET ${field}=?`).run(value);
      assert.throws(()=>f.store.list(field==='guild_id'?gb:ga),InstagramError);
      f.base.db.prepare(`UPDATE instagram_deliveries SET ${field}=?`).run(previous.value);
    }
    const wrongKey=new InstagramDeliveryStore(f.base.db,new Vault(randomBytes(32).toString('base64')));
    assert.throws(()=>wrongKey.reserve(ga,job.payload),InstagramError);
  }finally{f.base.close();}
});
test('invalid payloads, old/future messages, and invalid snowflakes cannot reserve work',t=>{
  const f=fixture();try{
    const now=Date.now();t.mock.method(Date,'now',()=>now);
    for(const patch of [{sourceMessageId:'012345678901234567'},{sourceMessageId:'99999999999999999999'},{sourceMessageId:snowflake(now-INSTAGRAM_SOURCE_MAX_AGE_MS)},{sourceMessageId:snowflake(now+60_001)},{sourceChannelId:destination},{settingsRevision:0},{url:'https://evil.test/p/AbC/'},{embedTitle:''},{extra:'unsupported'}])assert.throws(()=>f.store.reserve(ga,{...input(),...patch}));
    assert.equal(f.store.list(ga).length,0);
    assert.equal(f.store.reserve(ga,input({sourceMessageId:snowflake(now-INSTAGRAM_SOURCE_MAX_AGE_MS+1)})).created,true);
    assert.throws(()=>f.store.reserve(ga,input(),now-60_001),InstagramError);
  }finally{f.base.close();}
});
test('terminal delivery states cannot be reopened or overwritten by duplicate completions',()=>{
  const f=fixture();try{
    for(const status of ['sent','failed','uncertain'] as const){
      const payload=input({url:`https://instagram.com/p/${status}/`}),job=f.store.reserve(ga,payload).record;
      if(status==='sent')assert.throws(()=>f.store.finish(ga,job.jobId,'sent'));
      const result=f.store.finish(ga,job.jobId,status,status==='sent'?destination:null);
      assert.deepEqual(f.store.finish(ga,job.jobId,'uncertain'),result);
      assert.equal(f.store.reserve(ga,payload).created,false);
    }
    assert.throws(()=>f.store.finish(gb,f.store.list(ga)[0].jobId,'failed'),InstagramError);
  }finally{f.base.close();}
});
test('disk restart recovery keeps confirmed sends and marks interrupted reservations uncertain',()=>{
  const folder=mkdtempSync(join(tmpdir(),'instagram-deliveries-')),path=join(folder,'test.sqlite'),vault=new Vault(randomBytes(32).toString('base64'));
  let base:Store|undefined;
  try{
    base=new Store(path,vault);let store=new InstagramDeliveryStore(base.db,vault);
    const pending=store.reserve(ga,input()).record,confirmed=store.reserve(ga,input({url:'https://instagram.com/p/Sent/'})).record;
    store.finish(ga,confirmed.jobId,'sent',destination);base.close();base=undefined;
    base=new Store(path,vault);store=new InstagramDeliveryStore(base.db,vault);store.recover();
    assert.equal(store.get(ga,pending.jobId)?.status,'uncertain');assert.equal(store.get(ga,confirmed.jobId)?.status,'sent');
    assert.equal(store.reserve(ga,pending.payload).created,false);
  }finally{base?.close();rmSync(folder,{recursive:true,force:true});}
});
test('90-day expiry removes records without allowing replay of their old source messages',t=>{
  const f=fixture();try{
    let now=Date.now();t.mock.method(Date,'now',()=>now);const payload=input(),job=f.store.reserve(ga,payload).record;
    now+=INSTAGRAM_DELIVERY_RETENTION_MS;assert.equal(f.store.get(ga,job.jobId),null);assert.deepEqual(f.store.list(ga),[]);
    f.store.prune();assert.equal((f.base.db.prepare('SELECT COUNT(*) AS n FROM instagram_deliveries').get() as {n:number}).n,0);
    assert.throws(()=>f.store.reserve(ga,payload),InstagramError);
    f.store.reserve(ga,input());f.store.reserve(gb,input());f.store.removeGuild(ga);assert.deepEqual(f.store.list(ga),[]);assert.equal(f.store.list(gb).length,1);
  }finally{f.base.close();}
});
test('capacity counts every retained status without evicting duplicate protection; listing is bounded',()=>{
  const f=fixture();try{
    const first=f.store.reserve(ga,input()).record;
    const insert=f.base.db.prepare("INSERT INTO instagram_deliveries VALUES(?,?,?,?,'failed',NULL)");
    for(let i=1;i<INSTAGRAM_MAX_GUILD_DELIVERIES;i++)insert.run(ga,`padding-${i}`,'not-read-by-this-test',Date.now());
    assert.throws(()=>f.store.reserve(ga,input({url:'https://instagram.com/p/New/'})),(e:unknown)=>e instanceof InstagramError&&e.statusCode===429);
    assert.equal(f.store.reserve(ga,first.payload).created,false);
    for(let i=INSTAGRAM_MAX_GUILD_DELIVERIES;i<INSTAGRAM_MAX_DELIVERIES;i++)insert.run(gb,`padding-${i}`,'not-read-by-this-test',Date.now());
    assert.throws(()=>f.store.reserve(user,input()),InstagramError);
    f.store.removeGuild(ga);f.store.removeGuild(gb);
    for(let i=0;i<101;i++)f.store.reserve(ga,input({url:`https://instagram.com/p/Post${i}/`}));
    assert.equal(f.store.list(ga).length,100);
  }finally{f.base.close();}
});
