import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Events,GatewayIntentBits,type Client,type Message} from 'discord.js';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {readConfig} from '../server/config.js';
import {createBot} from '../server/bot/gateway.js';
import {BotSendError} from '../server/bot/types.js';
import {InstagramSettingsStore,InstagramSettingsService} from '../server/instagram/settings.js';
import {InstagramDeliveryStore} from '../server/instagram/deliveries.js';
import {InstagramPostingService} from '../server/instagram/service.js';
import {attachInstagramGateway} from '../server/instagram/gateway.js';
import type {InstagramPostingTransport,InstagramSourceEvent} from '../server/instagram/types.js';
import {buildApp} from '../server/app.js';
import type {DiscordApi} from '../server/discord.js';
const ga='11111111111111111',gb='22222222222222222',gc='33333333333333333',gd='44444444444444444',user='55555555555555555',source='66666666666666666',destination='77777777777777777',role='88888888888888888';
const configInput={sourceChannelIds:[source],destinationChannelId:destination,embedTitle:'Community post',embedDescription:'Custom text',embedColor:'#123456',enabled:true,expectedRevision:0};
function event(patch:Partial<InstagramSourceEvent>={}):InstagramSourceEvent{return {guildId:ga,sourceChannelId:source,sourceMessageId:((BigInt(Date.now())-1420070400000n)<<22n).toString(),authorId:user,content:'https://instagram.com/p/First/',...patch};}
function fixture(){
  const key=randomBytes(32).toString('base64'),vault=new Vault(key),base=new Store(':memory:',vault);
  const settings=new InstagramSettingsStore(base.db,vault,(...args)=>base.addActivity(...args)),deliveries=new InstagramDeliveryStore(base.db,vault);
  for(const guildId of [ga,gb,gc,gd])settings.save(guildId,user,configInput);
  let sends=0;const transport:InstagramPostingTransport={checkSetup:async()=>{},send:async(_guild,payload,_nonce,authorize)=>{authorize();sends++;return{id:destination};}};
  const service=new InstagramPostingService(settings,deliveries,transport,true,(...args)=>base.addActivity(...args));
  return {key,vault,base,settings,deliveries,transport,service,count:()=>sends};
}
test('posting requires both opt-ins and a configured source; old encrypted settings migrate disabled',async()=>{
  const f=fixture();try{
    const noRuntime=new InstagramPostingService(f.settings,f.deliveries,f.transport,false,()=>{});
    await noRuntime.process(event());await f.service.process(event({sourceChannelId:destination}));assert.equal(f.count(),0);
    const row=f.base.db.prepare('SELECT * FROM instagram_settings WHERE guild_id=?').get(ga) as {payload:string;revision:number;updated_at:number};
    const context=`instagram-settings:${JSON.stringify([ga,row.revision,row.updated_at])}`;
    const old=f.vault.open<Record<string,unknown>>(row.payload,context);delete old.enabled;
    f.base.db.prepare('UPDATE instagram_settings SET payload=? WHERE guild_id=?').run(f.vault.seal(old,context),ga);
    assert.equal(f.settings.get(ga).enabled,false);await f.service.process(event());assert.equal(f.count(),0);
  }finally{await f.service.stop();f.base.close();}
});
test('send reservations are committed first, repeat events do not resend, and only three links are processed',async()=>{
  const f=fixture();try{
    const send=f.transport.send;f.transport.send=async(g,p,n,a)=>{assert.equal(f.deliveries.list(g).some(row=>row.payload.url===p.url && row.status==='pending'),true);assert.match(n,/^[a-f0-9]{24}$/);return send(g,p,n,a);};
    const input=event({content:'https://instagram.com/p/First/ https://instagram.com/reel/First/ https://instagram.com/p/Second/ https://instagram.com/p/Third/ https://instagram.com/p/Fourth/'});
    await f.service.process(input);await f.service.process(input);assert.equal(f.count(),3);assert.equal(f.deliveries.list(ga).length,3);
    assert.ok(f.deliveries.list(ga).every(row=>row.status==='sent'));assert.equal(JSON.stringify(f.base.getActivity(ga)).includes('Custom text'),false);
  }finally{await f.service.stop();f.base.close();}
});
test('definite and ambiguous failures are durable and cannot automatically retry',async()=>{
  const f=fixture();try{
    let attempts=0;f.transport.send=async()=>{attempts++;throw new BotSendError('safe rejection',false);};
    const first=event();await f.service.process(first);await f.service.process(first);assert.equal(attempts,1);assert.equal(f.deliveries.list(ga)[0].status,'failed');
    f.transport.send=async()=>{attempts++;throw Error('private transport exception');};
    await f.service.process(event({content:'https://instagram.com/p/Unknown/'}));assert.equal(f.deliveries.list(ga).find(row=>row.payload.url.includes('Unknown'))?.status,'uncertain');
  }finally{await f.service.stop();f.base.close();}
});
test('a settings edit during preflight stops sending immediately before the POST',async()=>{
  const f=fixture();try{
    f.transport.send=async(g,_p,_n,authorize)=>{f.settings.save(g,user,{...configInput,enabled:false,expectedRevision:1});authorize();throw Error('unreachable');};
    await f.service.process(event());assert.equal(f.count(),0);assert.equal(f.deliveries.list(ga)[0].status,'failed');
  }finally{await f.service.stop();f.base.close();}
});
test('a confirmed POST followed by storage failure remains non-replayable',async t=>{
  const f=fixture();try{
    t.mock.method(f.deliveries,'finish',()=>{throw Error('disk write failed');});
    const input=event();await f.service.process(input);await f.service.process(input);assert.equal(f.count(),1);assert.equal(f.deliveries.list(ga)[0].status,'pending');
    f.deliveries.recover();assert.equal(f.deliveries.list(ga)[0].status,'uncertain');
  }finally{await f.service.stop();f.base.close();}
});
test('global and per-server work is bounded; stopping waits for preflight then prevents the send',async()=>{
  const f=fixture();try{
    let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});let calls=0;
    f.transport.send=async(_g,_p,_n,authorize)=>{calls++;await blocked;authorize();return{id:destination};};
    const pending=[ga,gb,gc].map((guildId,index)=>f.service.process(event({guildId,authorId:(BigInt(user)+BigInt(index)).toString()})));
    await f.service.process(event({guildId:gd}));await f.service.process(event());assert.equal(calls,3);
    let stopped=false;const stop=f.service.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
    release();await Promise.all([...pending,stop]);assert.equal(stopped,true);assert.ok([ga,gb,gc].every(g=>f.deliveries.list(g)[0].status==='failed'));
  }finally{await f.service.stop();f.base.close();}
});
test('per-user rate limits bound new events across servers and expire after a minute',async t=>{
  const f=fixture();try{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    for(let i=0;i<5;i++)await f.service.process(event({content:`https://instagram.com/p/Post${i}/`}));assert.equal(f.count(),3);
    now+=60_000;await f.service.process(event({content:'https://instagram.com/p/Later/'}));assert.equal(f.count(),4);
  }finally{await f.service.stop();f.base.close();}
});
test('the gateway ignores unrelated sources before reading content and never processes DMs/bots/webhooks/threads',async()=>{
  const client=Object.assign(new EventEmitter(),{isReady:()=>true});let accepts=false,calls=0;
  const gateway=attachInstagramGateway(client as unknown as Client,{accepts:()=>accepts,process:async()=>{calls++;}},true);
  const message={guildId:ga,channelId:source,id:event().sourceMessageId,author:{id:user,bot:false},partial:false,webhookId:null,system:false,channel:{type:0},content:'https://instagram.com/p/First/'};
  const hidden={...message};Object.defineProperty(hidden,'content',{get:()=>{throw Error('must not read');}});client.emit(Events.MessageCreate,hidden);
  accepts=true;
  for(const patch of [{guildId:null},{author:{id:user,bot:true}},{webhookId:user},{system:true},{partial:true},{channel:{type:11}}])client.emit(Events.MessageCreate,{...message,...patch});
  assert.equal(calls,0);client.emit(Events.MessageCreate,message as unknown as Message);await Promise.resolve();assert.equal(calls,1);
  gateway.stop();client.emit(Events.MessageCreate,message);assert.equal(calls,1);
});
test('Instagram gateway intents are explicitly opt-in and invalid flag values fail configuration',async()=>{
  for(const enabled of [false,true]){
    const bot=createBot(readConfig({INSTAGRAM_LINKS_ENABLED:enabled?'true':'false'}),{addActivity:()=>{},removeGuild:()=>{}});
    assert.equal(bot.client.options.intents.has(GatewayIntentBits.MessageContent),enabled);assert.equal(bot.client.options.intents.has(GatewayIntentBits.GuildMessages),enabled);await bot.stop();
  }
  assert.throws(()=>readConfig({INSTAGRAM_LINKS_ENABLED:'yes'}));
});
test('delivery status reads are authorized per server and never send or expose the stored author/body',async()=>{
  const f=fixture(),profile={id:user,username:'Fixture',avatar:null};let permission='8';
  const discord:DiscordApi={authorizeUrl:()=>'',exchange:async()=>({accessToken:'fixture',expiresIn:3600}),currentUser:async()=>profile,userGuilds:async()=>[],revoke:async()=>{},guildContext:async guildId=>({guild:{id:guildId,name:'Fixture',icon:null,ownerId:role},roles:[{id:guildId,name:'@everyone',permissions:'0',position:0},{id:role,name:'admin',permissions:permission,position:10}],memberRoleIds:[role]})};
  const cfg=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:ga,DISCORD_CLIENT_SECRET:'fixture',DISCORD_BOT_TOKEN:'fixture',DATA_ENCRYPTION_KEY:f.key});
  const settingsService=new InstagramSettingsService(f.settings,{options:async()=>({sourceChannels:[],destinationChannels:[]})},true,f.transport);
  const app=await buildApp(cfg,f.base,discord,undefined,undefined,undefined,undefined,settingsService,f.deliveries);
  const session=f.base.createSession({user:profile,accessToken:'fixture'},3600_000),headers={cookie:`dm_session=${session.id}`},url=`/api/guilds/${ga}/instagram/deliveries`;
  try{
    await f.service.process(event());assert.equal((await app.inject({url})).statusCode,401);assert.equal((await app.inject({url,headers})).statusCode,403);
    f.base.setGrant(ga,role,['instagram.manage'],user);const response=await app.inject({url,headers});assert.equal(response.statusCode,200);const data=response.json();assert.equal(data.deliveries[0].status,'sent');assert.equal('authorId' in data.deliveries[0],false);assert.equal('embedDescription' in data.deliveries[0],false);
    f.base.setGrant(gb,role,['instagram.manage'],user);assert.deepEqual((await app.inject({url:`/api/guilds/${gb}/instagram/deliveries`,headers})).json().deliveries,[]);
    permission='0';assert.equal((await app.inject({url,headers})).statusCode,403);assert.equal(f.count(),1);
  }finally{await app.close();await f.service.stop();f.base.close();}
});
