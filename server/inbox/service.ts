import { InboxError, type InboxAttachment } from '../../shared/inbox.js';
import { tokenHash } from '../crypto.js';
import { BotSendError } from '../bot/types.js';
import type { InboxGatewayService,InboxPersistence,InboxTransport } from './types.js';

export class InboxService implements InboxGatewayService {
  constructor(readonly persistence:InboxPersistence,private readonly transport:InboxTransport,private readonly activity:(guildId:string,actorId:string,action:string,targetId?:string|null)=>void) {}
  private record(guildId:string,actorId:string,action:string,targetId?:string) {try{this.activity(guildId,actorId,action,targetId);}catch{/* Do not expose private storage errors through Discord. */}}
  async contact(guildId:string,userId:string) {
    // A failed attempt to switch must not silently keep forwarding to old staff.
    this.persistence.clearRoute(userId);
    if(!this.persistence.getSettings(guildId).enabled)throw new InboxError(409,'Staff DMs are not enabled for this server. Contact a moderator through the server instead.');
    const guild=await this.transport.verifyMember(guildId,userId);
    if(guild.id!==guildId)throw new InboxError(403,'Your server membership could not be verified.');
    // Discord lookups can outlive a website settings change or guild removal.
    if(!this.persistence.getSettings(guildId).enabled)throw new InboxError(409,'Staff DMs are no longer enabled for this server. Contact a moderator through the server instead.');
    this.persistence.setRoute(userId,guildId);return guild;
  }
  async choices(userId:string) {
    this.persistence.clearRoute(userId);
    const enabled=this.persistence.enabledGuildIds();
    const guilds=(await this.transport.eligibleGuilds(userId,enabled)).filter(g=>enabled.includes(g.id)).slice(0,25);
    return {guilds,token:guilds.length ? this.persistence.createChoice(userId,guilds.map(g=>g.id)) : ''};
  }
  async choose(token:string,userId:string,guildId:string) {
    this.persistence.clearRoute(userId);
    if(!this.persistence.consumeChoice(token,userId,guildId))throw new InboxError(400,'That server selection expired or belongs to another person. Ask the bot to show your servers again.');
    return this.contact(guildId,userId);
  }
  async receive(input:{memberId:string;discordMessageId:string;content:string;attachments:InboxAttachment[];createdAt:number}) {
    const guildId=this.persistence.getRoute(input.memberId);
    if(!guildId || !this.persistence.getSettings(guildId).enabled) {this.persistence.clearRoute(input.memberId);return {routed:false as const};}
    let guild:{id:string;name:string};
    try{guild=await this.transport.verifyMember(guildId,input.memberId);}catch{this.persistence.clearRoute(input.memberId);return {routed:false as const};}
    if(guild.id!==guildId)throw new InboxError(403,'The selected server could not be verified.');
    if(!this.persistence.getSettings(guildId).enabled || this.persistence.getRoute(input.memberId)!==guildId) {
      return {routed:false as const};
    }
    const received=this.persistence.receive({...input,guildId});
    if(received.created)this.record(guildId,input.memberId,'inbox.received',received.ticket.id);
    return {routed:true as const,created:received.created,guildName:guild.name,ticketId:received.ticket.id};
  }
  async reply(guildId:string,ticketId:string,actorId:string,requestId:string,content:string) {
    const normalized=content.trim();
    if(!normalized || normalized.length>2000)throw new InboxError(400,'Replies must contain 1 to 2,000 characters.');
    const previous=this.persistence.getReply(guildId,ticketId,requestId);
    if(previous)return this.persistence.prepareReply(guildId,ticketId,actorId,requestId,normalized).message;
    if(!this.persistence.getSettings(guildId).enabled)throw new InboxError(409,'Enable the staff inbox before sending replies.');
    const ticket=this.persistence.getTicket(guildId,ticketId);
    if(!ticket)throw new InboxError(404,'This conversation was not found.');
    const guild=await this.transport.verifyMember(guildId,ticket.memberId);
    if(guild.id!==guildId)throw new InboxError(403,'The member’s server access could not be verified.');
    if(!this.persistence.getSettings(guildId).enabled)throw new InboxError(409,'The staff inbox was disabled before this reply could be sent.');
    const reserved=this.persistence.prepareReply(guildId,ticketId,actorId,requestId,normalized);
    if(!reserved.created)return reserved.message;
    try{
      const sent=await this.transport.sendReply({guildId,memberId:ticket.memberId,content:normalized,nonce:tokenHash(`inbox:${guildId}:${requestId}`).slice(0,24)});
      const message=this.persistence.finishReply(guildId,ticketId,requestId,'sent',sent.id);
      this.record(guildId,actorId,'inbox.replied',ticketId);return message;
    }catch(error){
      const status=error instanceof BotSendError && !error.uncertain ? 'failed' : 'uncertain';
      return this.persistence.finishReply(guildId,ticketId,requestId,status,null);
    }
  }
  configure(guildId:string,actorId:string,enabled:boolean) {
    this.persistence.setSettings(guildId,enabled);this.record(guildId,actorId,enabled?'inbox.enabled':'inbox.disabled');
  }
  close(guildId:string,ticketId:string,actorId:string) {this.persistence.closeTicket(guildId,ticketId);this.record(guildId,actorId,'inbox.closed',ticketId);}
}
