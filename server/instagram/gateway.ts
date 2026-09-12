import {ChannelType,Events,type Client,type Message} from 'discord.js';
import type {InstagramGatewayService} from './types.js';

/** The global intent is opt-in; discard unconfigured channel events before accessing content. */
export function attachInstagramGateway(client:Client,service:InstagramGatewayService,enabled=false){
  let stopped=false;
  const handle=(message:Message)=>{
    if(stopped || !enabled || !client.isReady() || !message.guildId || message.partial
      || message.author.bot || message.webhookId || message.system
      || ![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(message.channel.type))return;
    try{
      if(!service.accepts(message.guildId,message.channelId))return;
      const content=message.content;
      if(!content || content.length>4000)return;
      void service.process({guildId:message.guildId,sourceChannelId:message.channelId,sourceMessageId:message.id,authorId:message.author.id,content}).catch(()=>undefined);
    }catch{/* Never log source content or private Discord errors. */}
  };
  if(enabled)client.on(Events.MessageCreate,handle);
  return {stop(){stopped=true;if(enabled)client.off(Events.MessageCreate,handle);}};
}
