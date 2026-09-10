import { EventError, type EventDraft } from '../../shared/events.js';
import { tokenHash } from '../crypto.js';
import { BotSendError } from '../bot/types.js';
import { EventStore, publicEvent, type StoredEvent } from './store.js';
import { validateEventDraft } from './validation.js';
import type { EventTransport } from './types.js';

export class EventService {
  private activeGuilds=new Set<string>();
  constructor(readonly store:EventStore,readonly transport:EventTransport,private readonly activity:(guildId:string,actorId:string,action:string,targetId?:string|null)=>void) {}
  private record(g:string,a:string,action:string,target?:string) {try{this.activity(g,a,action,target);}catch{/* Do not expose stored descriptions or infrastructure errors. */}}
  private async locked<T>(guildId:string,work:()=>Promise<T>):Promise<T> {
    if(this.activeGuilds.has(guildId) || this.activeGuilds.size>=3)throw new EventError(409,'An event request is already being processed. Check its status before trying again.');
    this.activeGuilds.add(guildId);try{return await work();}finally{this.activeGuilds.delete(guildId);}
  }
  async create(guildId:string,actorId:string,requestId:string,input:unknown) {
    const draft:EventDraft=validateEventDraft(input);
    const signature=tokenHash(JSON.stringify([actorId,draft]));
    const match=(record:StoredEvent)=>{if(record.actorId!==actorId || record.signature!==signature)throw new EventError(409,'This request belongs to a different event draft.');return publicEvent(record);};
    const prior=this.store.get(guildId,requestId);if(prior)return match(prior);
    return this.locked(guildId,async()=>{
      if(Date.parse(draft.startTime)<Date.now()+60_000)throw new EventError(400,'Choose a start time at least one minute in the future.');
      await this.transport.preflight(guildId,draft);
      const reserved=this.store.reserve(guildId,actorId,requestId,signature,draft);
      if(!reserved.created)return match(reserved.record);
      let eventId:string;
      try {eventId=(await this.transport.create(guildId,draft)).id;}
      catch(error) {
        return publicEvent(this.store.eventResult(guildId,requestId,error instanceof BotSendError && !error.uncertain?'failed':'uncertain'));
      }
      // Persist Discord's result before the independent announcement POST.
      this.store.eventResult(guildId,requestId,'created',eventId);
      this.record(guildId,actorId,'event.created',eventId);
      return this.sendAnnouncement(guildId,actorId,requestId);
    });
  }
  async announce(guildId:string,actorId:string,requestId:string) {
    const existing=this.store.require(guildId,requestId);
    if(existing.eventStatus!=='created')throw new EventError(409,'An announcement requires a confirmed Discord event.');
    if(!['not_started','failed'].includes(existing.announcementStatus))return publicEvent(existing);
    return this.locked(guildId,()=>this.sendAnnouncement(guildId,actorId,requestId));
  }
  private async sendAnnouncement(guildId:string,actorId:string,requestId:string) {
    const record=this.store.require(guildId,requestId);
    if(!record.eventId || !this.store.beginAnnouncement(guildId,requestId))return publicEvent(this.store.require(guildId,requestId));
    let messageId:string;
    try {messageId=(await this.transport.announce(guildId,record.eventId,record.draft,tokenHash(`event-announcement:${guildId}:${requestId}`).slice(0,24))).id;}
    catch(error) {
      return publicEvent(this.store.announcementResult(guildId,requestId,error instanceof BotSendError && !error.uncertain?'failed':'uncertain'));
    }
    const result=this.store.announcementResult(guildId,requestId,'sent',messageId);
    this.record(guildId,actorId,'event.announced',record.eventId);return publicEvent(result);
  }
}
