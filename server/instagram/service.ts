import {z} from 'zod';
import {BotSendError} from '../bot/types.js';
import {findInstagramLinks} from './links.js';
import {instagramIdSchema,type InstagramSettingsStore} from './settings.js';
import type {InstagramDeliveryStore,InstagramDeliveryPayload} from './deliveries.js';
import type {InstagramGatewayService,InstagramPostingTransport,InstagramSourceEvent} from './types.js';

const eventSchema=z.object({guildId:instagramIdSchema,sourceChannelId:instagramIdSchema,sourceMessageId:instagramIdSchema,authorId:instagramIdSchema,content:z.string().max(4000)}).strict();
type Activity=(guildId:string,actorId:string,action:string,targetId:string)=>void;
type Rate={start:number;count:number};

export class InstagramPostingService implements InstagramGatewayService {
  private stopped=false;
  private readonly activeGuilds=new Set<string>();
  private readonly tasks=new Set<Promise<void>>();
  private readonly rates=new Map<string,Rate>();
  constructor(private readonly settings:InstagramSettingsStore,private readonly deliveries:InstagramDeliveryStore,
    private readonly transport:InstagramPostingTransport,private readonly available:boolean,private readonly activity:Activity){}
  accepts(guildId:string,sourceChannelId:string):boolean {
    if(this.stopped || !this.available)return false;
    const settings=this.settings.get(guildId);
    return settings.enabled && !!settings.destinationChannelId && settings.sourceChannelIds.includes(sourceChannelId);
  }
  process(event:InstagramSourceEvent):Promise<void>{
    if(this.stopped || this.tasks.size>=3)return Promise.resolve();
    const task=this.run(event);this.tasks.add(task);
    void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
  }
  private rate(key:string,max:number):boolean {
    const now=Date.now();let window=this.rates.get(key);
    if(!window || window.start+60_000<=now){
      for(const [id,value] of this.rates)if(value.start+60_000<=now)this.rates.delete(id);
      if(!window && this.rates.size>=5000)return false;
      window={start:now,count:0};this.rates.set(key,window);
    }
    return ++window.count<=max;
  }
  private record(event:InstagramSourceEvent,action:string,targetId:string){
    try{this.activity(event.guildId,event.authorId,action,targetId);}catch{/* Never log content or raw exceptions. */}
  }
  private async run(event:InstagramSourceEvent):Promise<void>{
    eventSchema.parse(event);
    if(!this.accepts(event.guildId,event.sourceChannelId))return;
    const links=findInstagramLinks(event.content).slice(0,3);if(!links.length)return;
    if(this.activeGuilds.size>=3 || this.activeGuilds.has(event.guildId))return;
    if(!this.rate(`user:${event.authorId}`,3) || !this.rate(`guild:${event.guildId}`,10) || !this.rate('global',60))return;
    this.activeGuilds.add(event.guildId);
    try{
      const settings=this.settings.get(event.guildId);
      if(!settings.enabled || !settings.destinationChannelId)return;
      for(const link of links){
        const authorize=()=>{
          const current=this.settings.get(event.guildId);
          if(this.stopped || !this.available || !current.enabled || current.revision!==settings.revision
            || current.destinationChannelId!==settings.destinationChannelId || !current.sourceChannelIds.includes(event.sourceChannelId)){
            throw new BotSendError('Instagram settings changed before delivery. Nothing was sent.',false);
          }
        };
        try{authorize();}catch{return;}
        const payload:InstagramDeliveryPayload={sourceMessageId:event.sourceMessageId,sourceChannelId:event.sourceChannelId,
          destinationChannelId:settings.destinationChannelId,authorId:event.authorId,settingsRevision:settings.revision,
          url:link.url,embedTitle:settings.embedTitle,embedDescription:settings.embedDescription,embedColor:settings.embedColor};
        const reserved=this.deliveries.reserve(event.guildId,payload);
        if(!reserved.created)continue;
        let messageId:string;
        try{messageId=(await this.transport.send(event.guildId,payload,reserved.record.jobId.slice(0,24),authorize)).id;}
        catch(error){
          const status=error instanceof BotSendError && !error.uncertain ? 'failed' : 'uncertain';
          try{this.deliveries.finish(event.guildId,reserved.record.jobId,status);}catch{/* Pending remains non-replayable and recovers uncertain. */}
          this.record(event,`instagram.${status}`,settings.destinationChannelId);continue;
        }
        try{this.deliveries.finish(event.guildId,reserved.record.jobId,'sent',messageId);this.record(event,'instagram.sent',messageId);}
        catch{
          try{this.deliveries.finish(event.guildId,reserved.record.jobId,'uncertain');}catch{/* Do not retry a confirmed POST after storage failure. */}
          this.record(event,'instagram.uncertain',settings.destinationChannelId);
        }
      }
    }finally{this.activeGuilds.delete(event.guildId);}
  }
  async stop(){this.stopped=true;await Promise.allSettled([...this.tasks]);this.rates.clear();}
}
