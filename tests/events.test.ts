import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {EventStore} from '../server/events/store.js';
import {EventService} from '../server/events/service.js';
import {validateEventDraft,validateGraphic} from '../server/events/validation.js';
import {EventError,type EventDraft} from '../shared/events.js';
import {BotSendError} from '../server/bot/types.js';
import type {EventTransport} from '../server/events/types.js';
import {readConfig} from '../server/config.js';
import {buildApp} from '../server/app.js';
import type {DiscordApi} from '../server/discord.js';

const ga='11111111111111111',gb='22222222222222222',admin='33333333333333333',role='44444444444444444',channel='55555555555555555',eventId='66666666666666666';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
function draft():EventDraft{return {name:'Community gathering',description:'Private planning description',startTime:new Date(Date.now()+3600_000).toISOString(),endTime:new Date(Date.now()+7200_000).toISOString(),entityType:'external',channelId:null,location:'Community hall',announcementChannelId:channel,announcementText:'Join us! @everyone',graphic:null};}
function fixture(){
  const key=randomBytes(32).toString('base64'),vault=new Vault(key),base=new Store(':memory:',vault),store=new EventStore(base.db,vault);
  let creates=0,announcements=0;
  const transport:EventTransport={options:async()=>({externalAllowed:true,eventChannels:[],announcementChannels:[{id:channel,name:'announcements'}]}),preflight:async()=>{},create:async()=>{creates++;return {id:eventId};},announce:async()=>{announcements++;return{id:'77777777777777777'};}};
  const service=new EventService(store,transport,(...args)=>base.addActivity(...args));
  return {key,vault,base,store,service,transport,counts:()=>({creates,announcements})};
}
test('event inputs validate locations, time order, fields, and bounded PNG/JPEG uploads',()=>{
  assert.equal(validateEventDraft(draft()).name,'Community gathering');
  validateGraphic(png);
  for(const patch of [{endTime:'2020-01-01T00:00:00.000Z'},{entityType:'voice',channelId:null},{location:null},{name:''},{extra:'unexpected'}])assert.throws(()=>validateEventDraft({...draft(),...patch}));
  for(const value of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8=',png+'='])assert.throws(()=>validateGraphic(value),EventError);
  const huge=Buffer.from(png.split(',')[1],'base64');huge.writeUInt32BE(9000,16);
  assert.throws(()=>validateGraphic(`data:image/png;base64,${huge.toString('base64')}`),EventError);
});
test('event and announcement are separate durable steps and retries never recreate a confirmed event',async()=>{
  const f=fixture();try{
    const id=randomUUID(),input=draft();input.graphic={data:png,alt:'A community gathering poster'};
    let persisted=false;const announce=f.transport.announce;
    f.transport.announce=async(...args)=>{persisted=f.store.require(ga,id).eventStatus==='created';return announce(...args);};
    const record=await f.service.create(ga,admin,id,input);
    assert.equal(persisted,true);assert.equal(record.eventStatus,'created');assert.equal(record.announcementStatus,'sent');
    assert.deepEqual(await f.service.create(ga,admin,id,input),record);
    assert.deepEqual(f.counts(),{creates:1,announcements:1});
    await f.service.announce(ga,admin,id);assert.equal(f.counts().announcements,1);
    assert.equal(JSON.stringify(f.base.getActivity(ga)).includes(input.description),false);
    const raw=JSON.stringify(f.base.db.prepare('SELECT * FROM event_jobs').all());
    assert.equal(raw.includes(input.description),false);assert.equal(raw.includes(png),false);assert.equal(JSON.stringify(record).includes(png),false);
    assert.equal(record.draft.graphicAlt,input.graphic.alt);assert.equal('signature' in record,false);
  }finally{f.base.close();}
});
test('request IDs cannot be reused by another actor or a changed draft',async()=>{
  const f=fixture();try{
    const id=randomUUID(),input=draft();await f.service.create(ga,admin,id,input);
    await assert.rejects(f.service.create(ga,role,id,input),EventError);
    await assert.rejects(f.service.create(ga,admin,id,{...input,name:'Changed'}),EventError);
    assert.equal(f.counts().creates,1);
  }finally{f.base.close();}
});
test('preflight failures and dates too close to now create no durable send request',async()=>{
  const f=fixture();try{
    const id=randomUUID();f.transport.preflight=async()=>{throw new EventError(403,'Missing permission');};
    await assert.rejects(f.service.create(ga,admin,id,draft()),EventError);assert.equal(f.store.get(ga,id),null);
    await assert.rejects(f.service.create(ga,admin,id,{...draft(),startTime:new Date().toISOString()}),EventError);
    assert.deepEqual(f.counts(),{creates:0,announcements:0});
  }finally{f.base.close();}
});
test('uncertain event creation is never automatically replayed or announced',async()=>{
  const f=fixture();try{
    let calls=0;f.transport.create=async()=>{calls++;throw Error('Timeout after POST');};
    const id=randomUUID(),input=draft();const result=await f.service.create(ga,admin,id,input);
    assert.equal(result.eventStatus,'uncertain');await f.service.create(ga,admin,id,input);
    await assert.rejects(f.service.announce(ga,admin,id),EventError);assert.equal(calls,1);assert.equal(f.counts().announcements,0);
  }finally{f.base.close();}
});
test('a definitely failed announcement can be retried without creating another event',async()=>{
  const f=fixture();try{
    const announce=f.transport.announce;f.transport.announce=async()=>{throw new BotSendError('Forbidden',false);};
    const id=randomUUID();const result=await f.service.create(ga,admin,id,draft());
    assert.equal(result.eventStatus,'created');assert.equal(result.announcementStatus,'failed');
    f.transport.announce=announce;
    assert.equal((await f.service.announce(ga,admin,id)).announcementStatus,'sent');
    assert.deepEqual(f.counts(),{creates:1,announcements:1});
  }finally{f.base.close();}
});
test('uncertain announcements and concurrent sends cannot duplicate external effects',async()=>{
  const f=fixture();try{
    let release!:()=>void;let calls=0;const blocked=new Promise<void>(resolve=>{release=resolve;});
    f.transport.announce=async()=>{calls++;await blocked;throw Error('Unknown result');};
    const id=randomUUID(),input=draft(),pending=f.service.create(ga,admin,id,input);
    while(!calls)await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await f.service.announce(ga,admin,id)).announcementStatus,'pending');
    await assert.rejects(f.service.create(ga,admin,randomUUID(),input),EventError);
    release();assert.equal((await pending).announcementStatus,'uncertain');
    await f.service.announce(ga,admin,id);assert.equal(calls,1);
  }finally{f.base.close();}
});
test('stored event drafts are authenticated and isolated by server',async()=>{
  const f=fixture();try{
    const id=randomUUID();await f.service.create(ga,admin,id,draft());
    assert.equal(f.store.get(gb,id),null);assert.deepEqual(f.store.list(gb),[]);
    assert.throws(()=>f.store.require(gb,id),EventError);
    f.base.db.prepare('UPDATE event_jobs SET actor_id=? WHERE request_id=?').run(role,id);
    assert.throws(()=>f.store.get(ga,id),EventError);
    f.base.db.prepare('UPDATE event_jobs SET actor_id=? WHERE request_id=?').run(admin,id);
    f.store.removeGuild(gb);assert.ok(f.store.get(ga,id));f.store.removeGuild(ga);assert.equal(f.store.get(ga,id),null);
  }finally{f.base.close();}
});
test('restart recovery preserves confirmed event IDs and marks unfinished POSTs uncertain',()=>{
  const f=fixture();try{
    const first=randomUUID(),second=randomUUID();
    f.store.reserve(ga,admin,first,'signature',draft());
    f.store.reserve(ga,admin,second,'signature',draft());f.store.eventResult(ga,second,'created',eventId);f.store.beginAnnouncement(ga,second);
    f.store.recover();assert.equal(f.store.require(ga,first).eventStatus,'uncertain');
    const result=f.store.require(ga,second);assert.equal(result.eventStatus,'created');assert.equal(result.eventId,eventId);assert.equal(result.announcementStatus,'uncertain');
  }finally{f.base.close();}
});
test('event history is bounded and disappears exactly at 90 days without deleting Discord events',t=>{
  const f=fixture();try{
    let now=Date.now();t.mock.method(Date,'now',()=>now);const id=randomUUID();f.store.reserve(ga,admin,id,'s',draft());
    for(let i=0;i<101;i++)f.store.reserve(ga,admin,randomUUID(),'s',draft());assert.equal(f.store.list(ga).length,100);
    now+=90*86_400_000;assert.equal(f.store.get(ga,id),null);assert.deepEqual(f.store.list(ga),[]);f.store.prune(now);
    assert.equal((f.base.db.prepare('SELECT COUNT(*) AS n FROM event_jobs').get() as {n:number}).n,0);
  }finally{f.base.close();}
});
test('event HTTP routes enforce Administrator plus grants, CSRF, and server boundaries',async()=>{
  const f=fixture(),user={id:admin,username:'Test',avatar:null};let permission='8';
  const discord:DiscordApi={authorizeUrl:()=>'',exchange:async()=>({accessToken:'fixture',expiresIn:3600}),currentUser:async()=>user,userGuilds:async()=>[],revoke:async()=>{},guildContext:async guildId=>({guild:{id:guildId,name:'Test',icon:null,ownerId:'88888888888888888'},roles:[{id:guildId,name:'everyone',permissions:'0',position:0},{id:role,name:'admin',permissions:permission,position:10}],memberRoleIds:[role]})};
  const config=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:ga,DISCORD_CLIENT_SECRET:'fixture',DISCORD_BOT_TOKEN:'fixture',DATA_ENCRYPTION_KEY:f.key});
  const app=await buildApp(config,f.base,discord,undefined,undefined,f.service);
  const session=f.base.createSession({user,accessToken:'fixture'},3600_000),headers={cookie:`dm_session=${session.id}`,origin:config.APP_ORIGIN,'x-csrf-token':session.data.csrfToken};
  const url=`/api/guilds/${ga}/events`,id=randomUUID();
  try{
    assert.equal((await app.inject({url})).statusCode,401);assert.equal((await app.inject({url,headers})).statusCode,403);
    f.base.setGrant(ga,role,['events.manage'],admin);
    assert.equal((await app.inject({url,headers})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url,headers,payload:{requestId:id,draft:draft()}})).statusCode,403);
    f.base.setGrant(ga,role,['events.manage','messages.send'],admin);
    assert.equal((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':'bad'},payload:{requestId:id,draft:draft()}})).statusCode,403);
    const result=await app.inject({method:'POST',url,headers,payload:{requestId:id,draft:draft()}});assert.equal(result.statusCode,200);assert.equal(result.json().record.announcementStatus,'sent');
    f.base.setGrant(gb,role,['events.manage'],admin);
    assert.equal((await app.inject({url:`/api/guilds/${gb}/events/${id}`,headers})).statusCode,404);
    permission='0';assert.equal((await app.inject({url:`${url}/${id}`,headers})).statusCode,403);
  }finally{await app.close();f.base.close();}
});
