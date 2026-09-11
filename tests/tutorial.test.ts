import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {TutorialStore} from '../server/tutorial/store.js';
import {TutorialService} from '../server/tutorial/service.js';
import {tutorialInputSchema} from '../server/tutorial/validation.js';
import {TutorialError,type TutorialChannel,type TutorialStepInput} from '../shared/tutorial.js';
import type {TutorialTransport} from '../server/tutorial/types.js';
import {readConfig} from '../server/config.js';
import {buildApp} from '../server/app.js';
import type {DiscordApi} from '../server/discord.js';

const ga='11111111111111111',gb='22222222222222222',admin='33333333333333333',role='44444444444444444',c1='55555555555555555',c2='66666666666666666',c3='77777777777777777';
const channels:TutorialChannel[]=[{id:c1,name:'welcome',type:0,position:0},{id:c2,name:'staff',type:0,position:1},{id:c3,name:'voice',type:2,position:2}];
const input=(patch:Partial<TutorialStepInput>={}):TutorialStepInput=>({title:'Start here',body:'Private authored guidance',published:true,expectedRevision:0,...patch});
function fixture(){
  const key=randomBytes(32).toString('base64'),vault=new Vault(key),base=new Store(':memory:',vault);
  const store=new TutorialStore(base.db,vault,(...args)=>base.addActivity(...args));
  const transport:TutorialTransport={channels:async()=>channels};
  const service=new TutorialService(store,transport);
  return {key,vault,base,store,transport,service};
}
test('tutorials require bounded content and complete published steps, allowing empty drafts',()=>{
  assert.deepEqual(tutorialInputSchema.parse(input({title:'  hello  '})),input({title:'hello'}));
  tutorialInputSchema.parse(input({title:'',body:'',published:false}));
  for(const patch of [{title:''},{body:'  '},{title:'a'.repeat(101)},{body:'a'.repeat(3001)},{expectedRevision:-1},{expectedRevision:0.5},{expectedRevision:Number.MAX_SAFE_INTEGER},{extra:true}]){
    assert.throws(()=>tutorialInputSchema.parse({...input(),...patch}));
  }
});
test('authored guidance is encrypted, authenticated with row metadata, and isolated by server',()=>{
  const f=fixture();try{
    const saved=f.store.save(ga,c1,admin,input());
    assert.equal(saved.revision,1);assert.equal(f.store.get(gb,c1),null);assert.deepEqual(f.store.list(gb),[]);
    const raw=JSON.stringify(f.base.db.prepare('SELECT * FROM tutorial_steps').all());
    assert.equal(raw.includes(input().body),false);assert.equal(raw.includes(input().title),false);
    const activity=JSON.stringify(f.base.getActivity(ga));assert.equal(activity.includes(input().body),false);
    for(const [field,value] of [['channel_id',c2],['guild_id',gb],['revision',2],['updated_at',0]] as const){
      const original=f.base.db.prepare(`SELECT ${field} AS value FROM tutorial_steps`).get() as {value:string|number};
      f.base.db.prepare(`UPDATE tutorial_steps SET ${field}=?`).run(value);
      assert.throws(()=>f.store.list(field==='guild_id'?gb:ga),TutorialError);
      f.base.db.prepare(`UPDATE tutorial_steps SET ${field}=?`).run(original.value);
    }
    f.store.removeGuild(gb);assert.ok(f.store.get(ga,c1));f.store.removeGuild(ga);assert.equal(f.store.get(ga,c1),null);
  }finally{f.base.close();}
});
test('concurrent editor revisions and clear operations cannot overwrite newer guidance',()=>{
  const f=fixture();try{
    f.store.save(ga,c1,admin,input());
    assert.throws(()=>f.store.save(ga,c1,admin,input({body:'stale edit'})),(e:unknown)=>e instanceof TutorialError&&e.statusCode===409);
    const cleared=f.store.save(ga,c1,admin,input({title:'',body:'',published:false,expectedRevision:1}));
    assert.equal(cleared.revision,2);
    for(const expectedRevision of [0,1]) assert.throws(()=>f.store.save(ga,c1,admin,input({expectedRevision})),TutorialError);
    assert.equal(f.store.get(ga,c1)?.body,'');assert.equal(f.base.getActivity(ga).length,2);
  }finally{f.base.close();}
});
test('a failed activity write rolls back the tutorial configuration change',()=>{
  const f=fixture();try{
    const broken=new TutorialStore(f.base.db,f.vault,()=>{throw Error('disk unavailable');});
    assert.throws(()=>broken.save(ga,c1,admin,input()));assert.equal(f.store.get(ga,c1),null);
  }finally{f.base.close();}
});
test('active tutorial configuration survives the message retention window',()=>{
  const f=fixture();try{
    f.store.save(ga,c1,admin,input());f.base.prune(Date.now()+91*86_400_000);
    assert.equal(f.store.get(ga,c1)?.body,input().body);assert.deepEqual(f.base.getActivity(ga),[]);
  }finally{f.base.close();}
});
test('member pages include only published, currently visible channels in transport order',async()=>{
  const f=fixture();try{
    f.store.save(ga,c1,admin,input());f.store.save(ga,c2,admin,input({title:'Staff secrets'}));f.store.save(ga,c3,admin,input({published:false}));
    let requestedUser:string|undefined;
    f.transport.channels=async(guildId,userId)=>{assert.equal(guildId,ga);requestedUser=userId;return [channels[2],channels[0]];};
    const first=await f.service.page(ga,admin);
    assert.equal(requestedUser,admin);assert.equal(first?.channel.id,c1);assert.equal(first?.total,1);assert.equal(first?.index,0);
    assert.equal(first?.previousChannelId,null);assert.equal(first?.nextChannelId,null);assert.equal(JSON.stringify(first).includes('Staff secrets'),false);
    await assert.rejects(f.service.page(ga,admin,c2),TutorialError);
    await assert.rejects(f.service.page(ga,admin,c3),TutorialError);
    f.store.save(ga,c3,admin,input({expectedRevision:1}));
    const later=await f.service.page(ga,admin,c1);assert.equal(later?.previousChannelId,c3);assert.equal(later?.index,1);
    f.transport.channels=async()=>[];assert.equal(await f.service.page(ga,admin),null);
  }finally{f.base.close();}
});
test('unpublishing during a live channel lookup does not return an old published page',async()=>{
  const f=fixture();try{
    f.store.save(ga,c1,admin,input());
    let release!:(value:TutorialChannel[])=>void;f.transport.channels=()=>new Promise(resolve=>{release=resolve;});
    const pending=f.service.page(ga,admin);
    f.store.save(ga,c1,admin,input({published:false,expectedRevision:1}));release(channels);
    assert.equal(await pending,null);
  }finally{f.base.close();}
});
test('editor and save recheck bot channel visibility and never return another server configuration',async()=>{
  const f=fixture();try{
    f.store.save(ga,c1,admin,input());f.store.save(ga,c2,admin,input({title:'Unavailable'}));
    f.transport.channels=async(_guildId,userId)=>{assert.equal(userId,undefined);return [channels[0]];};
    assert.equal((await f.service.editor(ga)).steps.length,1);
    assert.deepEqual((await f.service.editor(gb)).steps,[]);
    await assert.rejects(f.service.save(ga,c2,admin,input({expectedRevision:1})),TutorialError);
    f.transport.channels=async()=>{throw new Error('Discord unavailable');};
    await assert.rejects(f.service.save(ga,c1,admin,input({expectedRevision:1,body:'New'})));
    assert.equal(f.store.get(ga,c1)?.body,input().body);
  }finally{f.base.close();}
});
test('tutorial lookups have a shared concurrency bound that releases after errors',async()=>{
  const f=fixture();try{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    f.transport.channels=async()=>{await wait;throw Error('offline');};
    const pending=[f.service.page(ga,admin),f.service.editor(ga),f.service.save(ga,c1,admin,input())];
    const settled=Promise.allSettled(pending);
    await assert.rejects(f.service.page(ga,admin),(e:unknown)=>e instanceof TutorialError&&e.statusCode===429);
    release();assert.ok((await settled).every(result=>result.status==='rejected'));
    f.transport.channels=async()=>channels;assert.equal(await f.service.page(ga,admin),null);
  }finally{f.base.close();}
});
test('HTTP tutorial routes require Discord login AND Administrator/ownership AND tutorial grants, with CSRF and server isolation',async()=>{
  const f=fixture(),user={id:admin,username:'Test',avatar:null};let permission='8',ownerId='88888888888888888';
  const discord:DiscordApi={authorizeUrl:()=>'',exchange:async()=>({accessToken:'fixture',expiresIn:3600}),currentUser:async()=>user,userGuilds:async()=>[],revoke:async()=>{},guildContext:async guildId=>({guild:{id:guildId,name:'Test',icon:null,ownerId},roles:[{id:guildId,name:'everyone',permissions:'0',position:0},{id:role,name:'admin',permissions:permission,position:10}],memberRoleIds:[role]})};
  const config=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:ga,DISCORD_CLIENT_SECRET:'fixture',DISCORD_BOT_TOKEN:'fixture',DATA_ENCRYPTION_KEY:f.key});
  const app=await buildApp(config,f.base,discord,undefined,undefined,undefined,f.service);
  const session=f.base.createSession({user,accessToken:'fixture'},3600_000),headers={cookie:`dm_session=${session.id}`,origin:config.APP_ORIGIN,'x-csrf-token':session.data.csrfToken};
  const url=`/api/guilds/${ga}/tutorial`;
  const save=()=>app.inject({method:'PUT',url:`${url}/${c1}`,headers,payload:input()});
  try{
    assert.equal((await app.inject({url})).statusCode,401);assert.equal((await app.inject({url,headers})).statusCode,403);
    assert.equal((await save()).statusCode,403);f.base.setGrant(ga,role,['tutorial.manage'],admin);
    assert.equal((await app.inject({url,headers})).statusCode,200);
    assert.equal((await app.inject({method:'PUT',url:`${url}/${c1}`,headers:{...headers,'x-csrf-token':'bad'},payload:input()})).statusCode,403);
    assert.equal((await app.inject({method:'PUT',url:`${url}/${c1}`,headers:{...headers,origin:'https://example.com'},payload:input()})).statusCode,403);
    assert.equal((await save()).statusCode,200);assert.equal((await save()).statusCode,409);
    assert.equal((await app.inject({method:'PUT',url:`${url}/${c1}`,headers,payload:input({body:'x'.repeat(3001)})})).statusCode,400);
    f.base.setGrant(gb,role,['tutorial.manage'],admin);
    assert.deepEqual((await app.inject({url:`/api/guilds/${gb}/tutorial`,headers})).json().steps,[]);
    permission='0';assert.equal((await app.inject({url,headers})).statusCode,403);assert.equal((await save()).statusCode,403);
    ownerId=admin;f.base.setGrant(ga,role,[],admin);assert.equal((await app.inject({url,headers})).statusCode,200);
    assert.equal(f.store.get(ga,c1)?.revision,1);
  }finally{await app.close();f.base.close();}
});
