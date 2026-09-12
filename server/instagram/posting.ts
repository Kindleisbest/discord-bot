import {
  ChannelType, EmbedBuilder, OverwriteType, PermissionFlagsBits as P,
  type Client, type GuildBasedChannel, type GuildMember, type NewsChannel, type TextChannel,
} from 'discord.js';
import {BotSendError} from '../bot/types.js';
import {classifySendError} from '../bot/gateway.js';
import {INSTAGRAM_SOURCE_MAX_AGE_MS} from './deliveries.js';
import {findInstagramLinks,normalizeInstagramLink} from './links.js';
import type {InstagramPostingTransport} from './types.js';

const SOURCE_PERMISSIONS=[P.ViewChannel,P.ReadMessageHistory];
const DESTINATION_PERMISSIONS=[P.ViewChannel,P.SendMessages,P.EmbedLinks];
let active=0;
class PreflightError extends BotSendError {
  constructor(message:string){super(message,false);}
}
function failedPreflight(error:unknown):BotSendError {
  return error instanceof PreflightError ? error : new BotSendError(
    'The source message, channel audience, and current permissions could not be verified. No announcement was sent.',false);
}
function validId(value:unknown):value is string {
  return typeof value==='string' && /^[1-9]\d{16,19}$/.test(value) && BigInt(value)<=0xffffffffffffffffn;
}
function recentSource(id:string) {
  const timestamp=Number((BigInt(id)>>22n)+1420070400000n),now=Date.now();
  if(timestamp<=now-INSTAGRAM_SOURCE_MAX_AGE_MS || timestamp>now+60_000) {
    throw new PreflightError('This source message is outside the announcement time window.');
  }
}
function textChannel(channel:GuildBasedChannel|null,guildId:string,id:string):channel is TextChannel|NewsChannel {
  return !!channel && channel.id===id && channel.guildId===guildId
    && (channel.type===ChannelType.GuildText || channel.type===ChannelType.GuildAnnouncement);
}

/** Identical View Channel rules conservatively preserve the same guild audience.
 * Only the posting bot's own member overwrite can differ safely. Other permission
 * bits do not change who can view a top-level channel. */
export function matchingInstagramAudience(source:TextChannel|NewsChannel,destination:TextChannel|NewsChannel,botId:string):boolean {
  const signature=(channel:TextChannel|NewsChannel)=>[...channel.permissionOverwrites.cache.values()]
    .filter(row=>!(row.type===OverwriteType.Member && row.id===botId))
    .map(row=>({id:row.id,type:row.type,allow:row.allow.bitfield&P.ViewChannel,deny:row.deny.bitfield&P.ViewChannel}))
    .filter(row=>row.allow!==0n || row.deny!==0n)
    .map(row=>`${row.type}:${row.id}:${row.allow}:${row.deny}`).sort().join('|');
  return source.guildId===destination.guildId && signature(source)===signature(destination);
}
function checkedRoute(source:TextChannel|NewsChannel,destination:TextChannel|NewsChannel,bot:GuildMember,botId:string) {
  if(!source.permissionsFor(bot)?.has(SOURCE_PERMISSIONS)) {
    throw new PreflightError('The bot needs View Channel and Read Message History in every source channel.');
  }
  if(!destination.permissionsFor(bot)?.has(DESTINATION_PERMISSIONS)) {
    throw new PreflightError('The bot needs View Channel, Send Messages, and Embed Links in the destination.');
  }
  if(!matchingInstagramAudience(source,destination,botId)) {
    throw new PreflightError('Source and destination must have matching View Channel rules for roles and members.');
  }
}
async function limited<T>(operation:()=>Promise<T>):Promise<T> {
  if(active>=3)throw new PreflightError('Instagram channel checks are busy. Try again shortly.');
  active++;
  try{return await operation();}finally{active--;}
}

export function createInstagramPostingTransport(client:Client):InstagramPostingTransport {
  function ready(expectedBotId?:string) {
    if(!client.isReady() || !client.user || (expectedBotId && client.user.id!==expectedBotId)) {
      throw new PreflightError('The bot is not connected to Discord. No announcement was sent.');
    }
    return client.user.id;
  }
  async function freshGuild(guildId:string) {
    const botId=ready();
    if(!validId(guildId))throw new PreflightError('Choose a valid server.');
    const guild=await client.guilds.fetch({guild:guildId,force:true});
    if(guild.id!==guildId)throw new PreflightError('The selected server could not be verified.');
    const [roles,bot]=await Promise.all([guild.roles.fetch(),guild.members.fetchMe({force:true})]);
    for(const id of guild.roles.cache.keys())if(!roles.has(id))guild.roles.cache.delete(id);
    if(bot.id!==botId || bot.guild.id!==guildId)throw new PreflightError('The bot membership could not be verified.');
    ready(botId);
    return {guild,bot,botId};
  }
  return {
    checkSetup(guildId,settings){return limited(async()=>{
      try{
        const sources=settings.sourceChannelIds,destinationId=settings.destinationChannelId;
        if(!validId(guildId) || !Array.isArray(sources) || sources.length>25 || sources.some(id=>!validId(id))
          || new Set(sources).size!==sources.length || (destinationId!==null && !validId(destinationId))
          || (destinationId!==null && sources.includes(destinationId)))throw new PreflightError('Choose valid, different source and destination channels.');
        if(settings.enabled && (!sources.length || !destinationId))throw new PreflightError('Choose at least one source channel and a destination before enabling announcements.');
        if(!sources.length && !destinationId)return;
        if(!destinationId)throw new PreflightError('Choose a destination for the selected source channels.');
        const {guild,bot,botId}=await freshGuild(guildId);
        const destination=await guild.channels.fetch(destinationId,{force:true});
        if(!textChannel(destination,guildId,destinationId)
          || !destination.permissionsFor(bot)?.has(DESTINATION_PERMISSIONS))throw new PreflightError('The destination must be a text or announcement channel where the bot can send embeds.');
        // At most one source lookup at a time: a saved setup cannot fan out 25 REST requests.
        for(const sourceId of sources){
          const source=await guild.channels.fetch(sourceId,{force:true});
          if(!textChannel(source,guildId,sourceId))throw new PreflightError('Each source must be a text or announcement channel in this server.');
          checkedRoute(source,destination,bot,botId);
        }
        ready(botId);
      }catch(error){throw failedPreflight(error);}
    });},
    send(guildId,payload,nonce,authorize){return limited(async()=>{
      let destination:TextChannel|NewsChannel;
      let options:{embeds:EmbedBuilder[];allowedMentions:{parse:[];repliedUser:false};nonce:string;enforceNonce:true};
      try{
        const link=typeof payload.url==='string' ? normalizeInstagramLink(payload.url) : null;
        if(![guildId,payload.sourceChannelId,payload.destinationChannelId,payload.sourceMessageId,payload.authorId].every(validId)
          || payload.sourceChannelId===payload.destinationChannelId || !link || link.url!==payload.url
          || typeof nonce!=='string' || !/^[A-Za-z0-9_-]{1,25}$/.test(nonce)
          || !Number.isSafeInteger(payload.settingsRevision) || payload.settingsRevision<1
          || typeof payload.embedTitle!=='string' || payload.embedTitle.length>100
          || typeof payload.embedDescription!=='string' || payload.embedDescription.length>2000
          || typeof payload.embedColor!=='string' || !/^#[0-9a-fA-F]{6}$/.test(payload.embedColor)
          || typeof authorize!=='function')throw new PreflightError('This Instagram announcement request is invalid.');
        recentSource(payload.sourceMessageId);
        const {guild,bot,botId}=await freshGuild(guildId);
        const [source,target,author]=await Promise.all([
          guild.channels.fetch(payload.sourceChannelId,{force:true}),
          guild.channels.fetch(payload.destinationChannelId,{force:true}),
          guild.members.fetch({user:payload.authorId,force:true,cache:false}),
        ]);
        if(!textChannel(source,guildId,payload.sourceChannelId) || !textChannel(target,guildId,payload.destinationChannelId)) {
          throw new PreflightError('The selected source or destination channel is unavailable.');
        }
        checkedRoute(source,target,bot,botId);
        if(author.id!==payload.authorId || author.guild.id!==guildId || author.user.bot
          || !source.permissionsFor(author)?.has(P.ViewChannel) || !target.permissionsFor(author)?.has(P.ViewChannel)) {
          throw new PreflightError('The source author must still be a member who can view both channels.');
        }
        // Fetch only the explicit new message, never a history list or Instagram resource.
        const message=await source.messages.fetch({message:payload.sourceMessageId,force:true,cache:false});
        if(message.id!==payload.sourceMessageId || message.channelId!==payload.sourceChannelId || message.guildId!==guildId
          || message.author.id!==payload.authorId || message.author.bot || message.webhookId || message.system
          || !findInstagramLinks(message.content).some(current=>current.shortcode===link.shortcode && current.url===link.url)) {
          throw new PreflightError('The original member message no longer contains this Instagram link.');
        }
        checkedRoute(source,target,bot,botId);
        if(!source.permissionsFor(author)?.has(P.ViewChannel) || !target.permissionsFor(author)?.has(P.ViewChannel)) {
          throw new PreflightError('The source author can no longer view both channels.');
        }
        const embed=new EmbedBuilder().setURL(link.url).setColor(Number.parseInt(payload.embedColor.slice(1),16));
        if(payload.embedTitle)embed.setTitle(payload.embedTitle);
        if(payload.embedDescription)embed.setDescription(payload.embedDescription);
        destination=target;
        options={embeds:[embed],allowedMentions:{parse:[],repliedUser:false},nonce,enforceNonce:true};
        ready(botId);
        recentSource(payload.sourceMessageId);
        // No asynchronous work may separate this settings/revision check from POST.
        authorize();
      }catch(error){throw failedPreflight(error);}
      try{
        const message=await destination.send(options);
        return {id:message.id};
      }catch(error){throw classifySendError(error);}
    });},
  };
}
