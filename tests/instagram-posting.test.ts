import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChannelType, HTTPError, OverwriteType, PermissionFlagsBits as P, PermissionsBitField,
  type Client, type MessageCreateOptions, type TextChannel,
} from 'discord.js';
import type {InstagramSettings} from '../shared/instagram.js';
import {BotSendError} from '../server/bot/types.js';
import type {InstagramDeliveryPayload} from '../server/instagram/deliveries.js';
import {createInstagramPostingTransport,matchingInstagramAudience} from '../server/instagram/posting.js';

const GUILD='100000000000000001',OTHER='100000000000000002',BOT='100000000000000003';
const SOURCE='100000000000000004',DEST='100000000000000005',AUTHOR='100000000000000006',ROLE='100000000000000007';
const URL='https://www.instagram.com/reel/Abc_123/';
const snowflake=(time=Date.now()-1000)=>((BigInt(time)-1420070400000n)<<22n).toString();
const settings:InstagramSettings={enabled:true,sourceChannelIds:[SOURCE],destinationChannelId:DEST,
  embedTitle:'Instagram post shared',embedDescription:'A member shared this @everyone',embedColor:'#5865F2',revision:1,updatedAt:null};
const overwrite=(id:string,type:OverwriteType,allow:bigint[]=[],deny:bigint[]=[])=>({
  id,type,allow:new PermissionsBitField(allow),deny:new PermissionsBitField(deny),
});
const definitelyUnsent=(error:unknown)=>error instanceof BotSendError && !error.uncertain && !error.message.includes('private');

function harness(){
  const requests:unknown[]=[],actions:string[]=[],sent:MessageCreateOptions[]=[];
  const payload:InstagramDeliveryPayload={sourceMessageId:snowflake(),sourceChannelId:SOURCE,destinationChannelId:DEST,
    authorId:AUTHOR,settingsRevision:1,url:URL,embedTitle:settings.embedTitle,embedDescription:settings.embedDescription,embedColor:settings.embedColor};
  const bot={id:BOT,guild:{id:GUILD},user:{id:BOT,bot:true}};
  const author={id:AUTHOR,guild:{id:GUILD},user:{id:AUTHOR,bot:false}};
  const message={id:payload.sourceMessageId,channelId:SOURCE,guildId:GUILD,author:author.user,
    webhookId:null as string|null,system:false,content:`Look: ${URL}?igsh=private-tracking`};
  const state={ready:true,onMessage:()=>{},onSend:()=>{}};
  const makeChannel=(id:string,type:ChannelType)=>({
    id,guildId:GUILD,type,
    botPermissions:new PermissionsBitField([P.ViewChannel,P.ReadMessageHistory,P.SendMessages,P.EmbedLinks]),
    authorPermissions:new PermissionsBitField(P.ViewChannel),
    permissionsFor(member:{id:string}){return member.id===BOT?this.botPermissions:this.authorPermissions;},
    permissionOverwrites:{cache:new Map<string,ReturnType<typeof overwrite>>()},
    messages:{fetch:async(options:unknown)=>{requests.push({message:options});actions.push('message');state.onMessage();return message;}},
    send:async(options:MessageCreateOptions)=>{actions.push('send');sent.push(options);state.onSend();return {id:OTHER};},
  });
  const source=makeChannel(SOURCE,ChannelType.GuildText),destination=makeChannel(DEST,ChannelType.GuildAnnouncement);
  const channels=new Map([[SOURCE,source],[DEST,destination]]);
  const roles=new Map([[GUILD,{}],[ROLE,{}]]),roleCache=new Map([...roles,['deleted-role',{}]]);
  const guild={id:GUILD,
    roles:{cache:roleCache,fetch:async()=>{actions.push('roles');requests.push('roles');return roles;}},
    members:{
      fetchMe:async(options:unknown)=>{requests.push({bot:options});actions.push('bot');return bot;},
      fetch:async(options:unknown)=>{requests.push({author:options});actions.push('author');return author;},
    },
    channels:{fetch:async(id:string,options:unknown)=>{requests.push({channel:id,options});actions.push(id);return channels.get(id)??null;}},
  };
  const raw={user:{id:BOT},isReady:()=>state.ready,
    guilds:{fetch:async(options:unknown)=>{requests.push({guild:options});actions.push('guild');return guild;}}};
  const transport=createInstagramPostingTransport(raw as unknown as Client);
  const authorize=()=>{actions.push('authorize');};
  return {payload,bot,author,message,state,source,destination,channels,roles,roleCache,guild,raw,transport,authorize,requests,actions,sent};
}

test('setup refreshes guild, roles, bot and every route without reading or sending messages',async()=>{
  const h=harness();
  h.channels.set(OTHER,{...h.source,id:OTHER});
  await h.transport.checkSetup(GUILD,{...settings,sourceChannelIds:[SOURCE,OTHER]});
  assert.equal(h.roleCache.has('deleted-role'),false);
  assert.deepEqual(h.requests,[{guild:{guild:GUILD,force:true}},'roles',{bot:{force:true}},
    {channel:DEST,options:{force:true}},{channel:SOURCE,options:{force:true}},{channel:OTHER,options:{force:true}}]);
  assert.equal(h.sent.length,0);
});

test('setup requires nonempty enabled routes, unique sources, valid IDs and at most 25 sources',async()=>{
  for(const input of [
    {...settings,sourceChannelIds:[]}, {...settings,destinationChannelId:null},
    {...settings,sourceChannelIds:[SOURCE,SOURCE]}, {...settings,sourceChannelIds:[DEST]},
    {...settings,sourceChannelIds:['bad']}, {...settings,destinationChannelId:'18446744073709551616'},
    {...settings,sourceChannelIds:Array.from({length:26},(_,i)=>(100000000000000100n+BigInt(i)).toString())},
  ]){
    const h=harness();await assert.rejects(h.transport.checkSetup(GUILD,input),definitelyUnsent);
    assert.equal(h.requests.length,0);assert.equal(h.sent.length,0);
  }
  const h=harness();await h.transport.checkSetup(GUILD,{...settings,enabled:false,sourceChannelIds:[],destinationChannelId:null});
  assert.equal(h.requests.length,0);
});

test('matching audiences compare every role and member View Channel allow and deny only',()=>{
  const h=harness(),same=()=>matchingInstagramAudience(h.source as unknown as TextChannel,h.destination as unknown as TextChannel,BOT);
  assert.equal(same(),true);
  h.source.permissionOverwrites.cache.set(GUILD,overwrite(GUILD,OverwriteType.Role,[],[P.ViewChannel]));
  assert.equal(same(),false);
  h.destination.permissionOverwrites.cache.set(GUILD,overwrite(GUILD,OverwriteType.Role,[],[P.ViewChannel]));
  h.source.permissionOverwrites.cache.set(ROLE,overwrite(ROLE,OverwriteType.Role,[P.ViewChannel]));
  h.destination.permissionOverwrites.cache.set(ROLE,overwrite(ROLE,OverwriteType.Role,[P.ViewChannel,P.SendMessages]));
  h.source.permissionOverwrites.cache.set(OTHER,overwrite(OTHER,OverwriteType.Member,[P.SendMessages]));
  h.source.permissionOverwrites.cache.set(BOT,overwrite(BOT,OverwriteType.Member,[P.ViewChannel]));
  assert.equal(same(),true);
  h.source.permissionOverwrites.cache.set(AUTHOR,overwrite(AUTHOR,OverwriteType.Member,[P.ViewChannel]));
  assert.equal(same(),false);
  h.destination.permissionOverwrites.cache.set(AUTHOR,overwrite(AUTHOR,OverwriteType.Member,[P.ViewChannel]));
  assert.equal(same(),true);
  h.destination.permissionOverwrites.cache.set(AUTHOR,overwrite(AUTHOR,OverwriteType.Member,[],[P.ViewChannel]));
  assert.equal(same(),false);
  h.destination.permissionOverwrites.cache.set(AUTHOR,overwrite(AUTHOR,OverwriteType.Role,[P.ViewChannel]));
  assert.equal(same(),false);
});

test('send freshly checks one source message then authorizes immediately before one safe embed POST',async()=>{
  const h=harness();assert.deepEqual(await h.transport.send(GUILD,h.payload,'instagram_nonce',h.authorize),{id:OTHER});
  assert.equal(h.sent.length,1);
  assert.deepEqual(h.actions.slice(-3),['message','authorize','send']);
  assert.deepEqual(h.requests.filter(value=>typeof value==='object' && value && 'message' in value),[
    {message:{message:h.payload.sourceMessageId,force:true,cache:false}},
  ]);
  assert.ok(h.requests.some(value=>JSON.stringify(value)===JSON.stringify({author:{user:AUTHOR,force:true,cache:false}})));
  assert.equal(h.roleCache.has('deleted-role'),false);
  const sent=h.sent[0],embed=sent.embeds![0];
  assert.deepEqual('toJSON' in embed ? embed.toJSON() : embed,{
    url:URL,color:0x5865F2,title:settings.embedTitle,description:settings.embedDescription,
  });
  assert.deepEqual(sent.allowedMentions,{parse:[],repliedUser:false});
  assert.equal(sent.nonce,'instagram_nonce');assert.equal(sent.enforceNonce,true);
  assert.deepEqual(Object.keys(sent).sort(),['allowedMentions','embeds','enforceNonce','nonce']);
});

test('every source and destination permission is required again at delivery',async()=>{
  for(const [which,permissions] of [
    ['source',[P.ViewChannel,P.ReadMessageHistory]],['destination',[P.ViewChannel,P.SendMessages,P.EmbedLinks]],
  ] as const){
    for(const permission of permissions){
      const h=harness();await h.transport.checkSetup(GUILD,settings);
      h[which].botPermissions.remove(permission);
      await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
      assert.equal(h.sent.length,0);assert.equal(h.actions.includes('authorize'),false);
    }
  }
});

test('different or newly broader audiences are refused during setup and delivery',async()=>{
  for(const which of ['source','destination'] as const){
    for(const type of [OverwriteType.Role,OverwriteType.Member]){
      const h=harness();await h.transport.checkSetup(GUILD,settings);
      h[which].permissionOverwrites.cache.set(OTHER,overwrite(OTHER,type,[P.ViewChannel]));
      await assert.rejects(h.transport.checkSetup(GUILD,settings),definitelyUnsent);
      await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
      assert.equal(h.sent.length,0);
    }
  }
});

test('foreign, mismatched, missing or non-text routes cannot post',async()=>{
  for(const mutate of [
    (h:ReturnType<typeof harness>)=>{h.source.guildId=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.destination.guildId=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.source.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.destination.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.source.type=ChannelType.PublicThread;},
    (h:ReturnType<typeof harness>)=>{h.destination.type=ChannelType.GuildVoice;},
    (h:ReturnType<typeof harness>)=>{h.channels.delete(SOURCE);},
    (h:ReturnType<typeof harness>)=>{h.guild.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.bot.guild.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.bot.id=OTHER;},
  ]){
    const h=harness();mutate(h);await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.sent.length,0);
  }
});

test('author must still be the correct nonbot member with access to both channels',async()=>{
  for(const mutate of [
    (h:ReturnType<typeof harness>)=>{h.author.guild.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.author.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.author.user.bot=true;},
    (h:ReturnType<typeof harness>)=>{h.source.authorPermissions.remove(P.ViewChannel);},
    (h:ReturnType<typeof harness>)=>{h.destination.authorPermissions.remove(P.ViewChannel);},
    (h:ReturnType<typeof harness>)=>{h.guild.members.fetch=async()=>{throw new Error('private departed member');};},
  ]){
    const h=harness();mutate(h);await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.sent.length,0);assert.equal(h.actions.includes('message'),false);
  }
});

test('deleted, edited, foreign, automated and mismatched source messages cannot post',async()=>{
  for(const mutate of [
    (h:ReturnType<typeof harness>)=>{h.source.messages.fetch=async()=>{throw new HTTPError(404,'private','GET','private',{});};},
    (h:ReturnType<typeof harness>)=>{h.message.content='Edited to remove the link';},
    (h:ReturnType<typeof harness>)=>{h.message.content='https://example.com/?url='+URL;},
    (h:ReturnType<typeof harness>)=>{h.message.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.message.guildId=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.message.channelId=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.message.author={id:OTHER,bot:false};},
    (h:ReturnType<typeof harness>)=>{h.message.author={id:AUTHOR,bot:true};},
    (h:ReturnType<typeof harness>)=>{h.message.webhookId=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.message.system=true;},
  ]){
    const h=harness();mutate(h);await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.sent.length,0);assert.equal(h.actions.includes('authorize'),false);
  }
});

test('invalid and noncanonical payloads fail before Discord lookups',async()=>{
  for(const input of [
    {url:'https://instagram.com/reel/Abc_123/'},{url:URL+'?igsh=private'},
    {url:'https://www.instagram.com/reel/Abc_123'},{url:'https://example.com/reel/Abc_123/'},
    {sourceChannelId:DEST},{sourceChannelId:'bad'},{authorId:'18446744073709551616'},
    {sourceMessageId:snowflake(Date.now()-300_100)},{sourceMessageId:snowflake(Date.now()+61_000)},
    {embedColor:'private'},{embedTitle:'x'.repeat(101)},{embedDescription:'x'.repeat(2001)},{settingsRevision:0},
  ]){
    const h=harness();await assert.rejects(h.transport.send(GUILD,{...h.payload,...input},'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.requests.length,0);assert.equal(h.sent.length,0);
  }
  for(const nonce of ['', 'a'.repeat(26),'private nonce']){
    const h=harness();await assert.rejects(h.transport.send(GUILD,h.payload,nonce,h.authorize),definitelyUnsent);
    assert.equal(h.requests.length,0);
  }
});

test('final preflight rechecks readiness, audience and author access after message lookup',async()=>{
  for(const mutate of [
    (h:ReturnType<typeof harness>)=>{h.state.ready=false;},
    (h:ReturnType<typeof harness>)=>{h.raw.user.id=OTHER;},
    (h:ReturnType<typeof harness>)=>{h.source.botPermissions.remove(P.ReadMessageHistory);},
    (h:ReturnType<typeof harness>)=>{h.destination.authorPermissions.remove(P.ViewChannel);},
    (h:ReturnType<typeof harness>)=>{h.destination.permissionOverwrites.cache.set(OTHER,overwrite(OTHER,OverwriteType.Member,[P.ViewChannel]));},
  ]){
    const h=harness();h.state.onMessage=()=>mutate(h);
    await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.actions.includes('message'),true);assert.equal(h.actions.includes('authorize'),false);assert.equal(h.sent.length,0);
  }
});

test('a source aging beyond five minutes during lookups is never sent',async context=>{
  let now=Date.now();context.mock.method(Date,'now',()=>now);
  const h=harness();h.state.onMessage=()=>{now+=300_000;};
  await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
  assert.equal(h.actions.includes('message'),true);assert.equal(h.actions.includes('authorize'),false);assert.equal(h.sent.length,0);
});

test('lookup failures redact private errors and release operation slots',async()=>{
  for(const mutate of [
    (h:ReturnType<typeof harness>)=>{h.raw.guilds.fetch=async()=>{throw Error('private guild details');};},
    (h:ReturnType<typeof harness>)=>{h.guild.roles.fetch=async()=>{throw Error('private role details');};},
    (h:ReturnType<typeof harness>)=>{h.guild.members.fetchMe=async()=>{throw new BotSendError('private membership details',true);};},
    (h:ReturnType<typeof harness>)=>{h.guild.channels.fetch=async()=>{throw Error('private channel details');};},
  ]){
    const h=harness();mutate(h);
    await assert.rejects(h.transport.checkSetup(GUILD,settings),definitelyUnsent);
    await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
    assert.equal(h.sent.length,0);
  }
});

test('final settings authorization failure is definitely unsent and sanitizes callback errors',async()=>{
  const h=harness();
  await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',()=>{
    assert.equal(h.actions.at(-1),'message');throw new Error('private changed revision or stopped service');
  }),definitelyUnsent);
  assert.equal(h.sent.length,0);
});

test('only POST failures can be uncertain; neither rejection nor timeout is automatically retried',async()=>{
  for(const [error,uncertain] of [
    [new HTTPError(403,'private','POST','private',{}),false],
    [new HTTPError(500,'private','POST','private',{}),true],
    [new Error('private network timeout'),true],
  ] as const){
    const h=harness();h.state.onSend=()=>{throw error;};
    await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),result=>
      result instanceof BotSendError && result.uncertain===uncertain && !result.message.includes('private'));
    assert.equal(h.sent.length,1);
  }
  const h=harness();h.source.messages.fetch=async()=>{throw new HTTPError(500,'private','GET','private',{});};
  await assert.rejects(h.transport.send(GUILD,h.payload,'nonce',h.authorize),definitelyUnsent);
  assert.equal(h.sent.length,0);
});

test('three concurrent operations across transports are allowed and excess calls do not queue',async()=>{
  const h=harness();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  h.raw.guilds.fetch=async()=>{await gate;return h.guild;};
  const other=createInstagramPostingTransport(h.raw as unknown as Client);
  const pending=[h.transport.checkSetup(GUILD,settings),other.checkSetup(GUILD,settings),h.transport.send(GUILD,h.payload,'nonce',h.authorize)];
  try{
    await assert.rejects(other.send(GUILD,h.payload,'nonce2',h.authorize),definitelyUnsent);
    assert.equal(h.sent.length,0);
  }finally{release();await Promise.all(pending);}
  assert.equal(h.sent.length,1);
  await other.checkSetup(GUILD,settings);
});
