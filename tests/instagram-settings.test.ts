import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Collection,PermissionFlagsBits,type Client} from 'discord.js';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {InstagramSettingsStore,InstagramSettingsService,instagramSettingsSchema} from '../server/instagram/settings.js';
import {createInstagramSettingsTransport} from '../server/instagram/discord.js';
import {InstagramError,type InstagramSettingsInput} from '../shared/instagram.js';
import {buildApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import type {DiscordApi} from '../server/discord.js';
const ga='11111111111111111',gb='22222222222222222',user='33333333333333333',role='44444444444444444',source='55555555555555555',destination='66666666666666666';
const input=(patch:Partial<InstagramSettingsInput>={}):InstagramSettingsInput=>({sourceChannelIds:[source],destinationChannelId:destination,embedTitle:'Community Instagram',embedDescription:'Private custom wording',embedColor:'#aabbcc',expectedRevision:0,...patch});
function fixture(){
  const key=randomBytes(32).toString('base64'),vault=new Vault(key),base=new Store(':memory:',vault);
  const store=new InstagramSettingsStore(base.db,vault,(...args)=>base.addActivity(...args));
  const transport={options:async(_guildId:string)=>({sourceChannels:[{id:source,name:'social-links'}],destinationChannels:[{id:destination,name:'announcements'}]})};
  return {key,vault,base,store,transport,service:new InstagramSettingsService(store,transport)};
}
test('settings validate bounds, unique sources, destination separation, and cannot enable posting',()=>{
  assert.equal(instagramSettingsSchema.parse(input()).embedColor,'#AABBCC');
  for(const patch of [{sourceChannelIds:[source,source]},{sourceChannelIds:Array(26).fill(source)},{destinationChannelId:source},{embedTitle:' '},{embedTitle:'a'.repeat(101)},{embedDescription:'a'.repeat(2001)},{embedColor:'red'},{sourceChannelIds:['bad']},{expectedRevision:-1},{expectedRevision:0.5},{enabled:true}])assert.throws(()=>instagramSettingsSchema.parse({...input(),...patch}));
  instagramSettingsSchema.parse(input({sourceChannelIds:[],destinationChannelId:null,embedDescription:''}));
});
test('settings are isolated, encrypted, authenticated, persist as configuration, and remain disabled',()=>{
  const f=fixture();try{
    assert.equal(f.store.get(ga).enabled,false);assert.equal(f.store.get(ga).revision,0);
    const saved=f.store.save(ga,user,input());assert.equal(saved.enabled,false);assert.equal(saved.revision,1);
    assert.equal(f.store.get(gb).revision,0);
    assert.equal(JSON.stringify(f.base.db.prepare('SELECT * FROM instagram_settings').all()).includes(input().embedDescription),false);
    assert.equal(JSON.stringify(f.base.getActivity(ga)).includes(input().embedDescription),false);
    f.base.prune(Date.now()+91*86_400_000);assert.equal(f.store.get(ga).embedDescription,input().embedDescription);
    f.base.db.prepare('UPDATE instagram_settings SET guild_id=?').run(gb);assert.throws(()=>f.store.get(gb),InstagramError);
    f.base.db.prepare('UPDATE instagram_settings SET guild_id=?,revision=2').run(ga);assert.throws(()=>f.store.get(ga),InstagramError);
    f.base.db.prepare('UPDATE instagram_settings SET revision=1,updated_at=0').run();assert.throws(()=>f.store.get(ga),InstagramError);
    f.store.removeGuild(ga);assert.equal(f.store.get(ga).revision,0);
  }finally{f.base.close();}
});
test('stale settings and failed activity writes cannot replace a saved configuration',()=>{
  const f=fixture();try{
    f.store.save(ga,user,input());assert.throws(()=>f.store.save(ga,user,input()),(e:unknown)=>e instanceof InstagramError&&e.statusCode===409);
    const broken=new InstagramSettingsStore(f.base.db,f.vault,()=>{throw Error('storage failure');});
    assert.throws(()=>broken.save(ga,user,input({expectedRevision:1,embedTitle:'Replacement'})));
    assert.equal(f.store.get(ga).embedTitle,input().embedTitle);assert.equal(f.store.get(ga).revision,1);
  }finally{f.base.close();}
});
test('every save rechecks selected source and destination access and preserves data on failures',async()=>{
  const f=fixture();try{
    await f.service.save(ga,user,input());
    f.transport.options=async()=>({sourceChannels:[],destinationChannels:[]});
    await assert.rejects(f.service.save(ga,user,input({expectedRevision:1})),InstagramError);
    await assert.rejects(f.service.save(ga,user,input({sourceChannelIds:[],expectedRevision:1})),InstagramError);
    f.transport.options=async()=>{throw Error('offline');};
    await assert.rejects(f.service.save(ga,user,input({expectedRevision:1})));
    assert.equal(f.store.get(ga).revision,1);
  }finally{f.base.close();}
});
test('settings HTTP routes enforce login, current Administrator and both grants, CSRF, and no enable option',async()=>{
  const f=fixture();let permission='8',ownerId='77777777777777777';const profile={id:user,username:'Fixture',avatar:null};
  const discord:DiscordApi={authorizeUrl:()=>'',exchange:async()=>({accessToken:'fixture',expiresIn:3600}),currentUser:async()=>profile,userGuilds:async()=>[],revoke:async()=>{},guildContext:async guildId=>({guild:{id:guildId,name:'Fixture',icon:null,ownerId},roles:[{id:guildId,name:'everyone',permissions:'0',position:0},{id:role,name:'Administrator',permissions:permission,position:10}],memberRoleIds:[role]})};
  const config=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:ga,DISCORD_CLIENT_SECRET:'fixture',DISCORD_BOT_TOKEN:'fixture',DATA_ENCRYPTION_KEY:f.key});
  const app=await buildApp(config,f.base,discord,undefined,undefined,undefined,undefined,f.service);
  const session=f.base.createSession({user:profile,accessToken:'fixture'},3600_000),headers={cookie:`dm_session=${session.id}`,origin:config.APP_ORIGIN,'x-csrf-token':session.data.csrfToken},url=`/api/guilds/${ga}/instagram`;
  const save=(payload:unknown=input(),h=headers)=>app.inject({method:'PUT',url,headers:h,payload:payload as object});
  try{
    assert.equal((await app.inject({url})).statusCode,401);assert.equal((await app.inject({url,headers})).statusCode,403);
    f.base.setGrant(ga,role,['instagram.manage'],user);assert.equal((await app.inject({url,headers})).statusCode,200);assert.equal((await save()).statusCode,403);
    f.base.setGrant(ga,role,['instagram.manage','messages.send'],user);
    assert.equal((await save(input(),{...headers,'x-csrf-token':'bad'})).statusCode,403);
    assert.equal((await save(input(),{...headers,origin:'https://example.com'})).statusCode,403);
    assert.equal((await save({...input(),enabled:true})).statusCode,400);
    assert.equal((await save()).json().settings.enabled,false);assert.equal((await save()).statusCode,409);
    f.base.setGrant(gb,role,['instagram.manage'],user);assert.equal((await app.inject({url:`/api/guilds/${gb}/instagram`,headers})).json().settings.revision,0);
    permission='0';assert.equal((await app.inject({url:`${url}/options`,headers})).statusCode,403);assert.equal((await save()).statusCode,403);
    ownerId=user;assert.equal((await app.inject({url,headers})).statusCode,200);
  }finally{await app.close();f.base.close();}
});
function discordFixture(){
  const calls:string[]=[],cache=new Collection([['stale',{id:'stale'}]]);let canSend=true,ready=true;
  const guild={id:ga,roles:{cache,fetch:async()=>{calls.push('roles');return new Collection();}},members:{fetchMe:async()=>{calls.push('bot');return {id:user,guild:{id:ga}};}},channels:{fetch:async()=>{calls.push('channels');return new Collection([
    [source,{id:source,guildId:ga,name:'source',type:0,permissionsFor:()=>({has:(p:unknown)=>p===PermissionFlagsBits.ViewChannel})}],
    [destination,{id:destination,guildId:ga,name:'destination',type:5,permissionsFor:()=>({has:(p:unknown)=>p===PermissionFlagsBits.ViewChannel || canSend})}],
    [role,{id:role,guildId:gb,name:'foreign',type:0,permissionsFor:()=>({has:()=>true})}],
  ]);}}};
  const client={isReady:()=>ready,user:{id:user},guilds:{fetch:async()=>{calls.push('guild');return guild;}}} as unknown as Client;
  return {client,guild,calls,cache,setSend:(value:boolean)=>{canSend=value;},setReady:(value:boolean)=>{ready=value;}};
}
test('channel discovery refreshes roles/bot/channels, removes stale roles, and separates source/send permissions',async()=>{
  const f=discordFixture(),transport=createInstagramSettingsTransport(f.client);
  const options=await transport.options(ga);assert.deepEqual(f.calls,['guild','roles','bot','channels']);assert.equal(f.cache.size,0);
  assert.deepEqual(options.sourceChannels.map(c=>c.id),[destination,source]);assert.deepEqual(options.destinationChannels.map(c=>c.id),[destination]);
  f.setSend(false);assert.deepEqual((await transport.options(ga)).destinationChannels,[]);
  f.setReady(false);await assert.rejects(transport.options(ga),InstagramError);
});
test('channel discovery rejects mismatched identities and bounds concurrent refresh work',async()=>{
  const f=discordFixture(),transport=createInstagramSettingsTransport(f.client);
  f.guild.id=gb;await assert.rejects(transport.options(ga),InstagramError);f.guild.id=ga;
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  f.guild.roles.fetch=async()=>{await wait;throw Error('raw Discord error');};
  const pending=[transport.options(ga),transport.options(ga),transport.options(ga)];const settled=Promise.allSettled(pending);
  await assert.rejects(transport.options(ga),(e:unknown)=>e instanceof InstagramError&&e.statusCode===429);
  release();for(const r of await settled){assert.equal(r.status,'rejected');if(r.status==='rejected')assert.equal(r.reason.message.includes('raw Discord'),false);}
  await assert.rejects(transport.options('invalid'));
});
