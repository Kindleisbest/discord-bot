import {ChannelType,PermissionFlagsBits,type Client} from 'discord.js';
import {InstagramError,type InstagramOptions} from '../../shared/instagram.js';
import {instagramIdSchema,type InstagramSettingsTransport} from './settings.js';

const sendPermissions=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks];
let active=0;
export function createInstagramSettingsTransport(client:Client):InstagramSettingsTransport {
  return {async options(guildId){
    instagramIdSchema.parse(guildId);
    if(active>=3)throw new InstagramError(429,'Channel checks are busy. Try again shortly.');
    active++;
    try{
      if(!client.isReady() || !client.user)throw Error('offline');
      const botId=client.user.id;
      const guild=await client.guilds.fetch({guild:guildId,force:true});
      if(guild.id!==guildId)throw Error('guild mismatch');
      const roles=await guild.roles.fetch();
      for(const id of guild.roles.cache.keys())if(!roles.has(id))guild.roles.cache.delete(id);
      const bot=await guild.members.fetchMe({force:true});
      if(bot.id!==botId || bot.guild.id!==guildId)throw Error('member mismatch');
      const channels=await guild.channels.fetch();
      const result:InstagramOptions={sourceChannels:[],destinationChannels:[]};
      for(const channel of channels.values()){
        if(!channel || channel.guildId!==guildId || ![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(channel.type))continue;
        const permissions=channel.permissionsFor(bot);
        if(!permissions?.has(PermissionFlagsBits.ViewChannel))continue;
        const item={id:channel.id,name:channel.name};result.sourceChannels.push(item);
        if(permissions.has(sendPermissions))result.destinationChannels.push(item);
      }
      if(!client.isReady() || client.user?.id!==botId)throw Error('offline');
      for(const list of [result.sourceChannels,result.destinationChannels])list.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
      return result;
    }catch{throw new InstagramError(503,'The bot could not verify current channel access. Try again shortly.');}
    finally{active--;}
  }};
}
