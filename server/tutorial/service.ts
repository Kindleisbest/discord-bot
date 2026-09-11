import { TutorialError, type TutorialPage, type TutorialStepInput } from '../../shared/tutorial.js';
import type { TutorialGatewayService, TutorialTransport } from './types.js';
import type { TutorialStore } from './store.js';
import { tutorialIdSchema, tutorialInputSchema } from './validation.js';

export class TutorialService implements TutorialGatewayService {
  private active=0;
  constructor(readonly store:TutorialStore,readonly transport:TutorialTransport) {}
  private async limited<T>(action:()=>Promise<T>):Promise<T> {
    if (this.active>=3) throw new TutorialError(429,'Tutorials are busy. Please try again shortly.');
    this.active++;
    try { return await action(); } finally { this.active--; }
  }
  async editor(guildId:string) {
    tutorialIdSchema.parse(guildId);
    return this.limited(async()=>{
      const channels=await this.transport.channels(guildId);
      const visible=new Set(channels.map(channel=>channel.id));
      return {channels,steps:this.store.list(guildId).filter(step=>visible.has(step.channelId))};
    });
  }
  async save(guildId:string,channelId:string,actorId:string,input:TutorialStepInput) {
    tutorialIdSchema.parse(guildId); tutorialIdSchema.parse(channelId); tutorialIdSchema.parse(actorId);
    const validated=tutorialInputSchema.parse(input);
    return this.limited(async()=>{
      const channels=await this.transport.channels(guildId);
      if (!channels.some(channel=>channel.id===channelId)) throw new TutorialError(404,'This channel is unavailable to the bot or does not support a tutorial.');
      return this.store.save(guildId,channelId,actorId,validated);
    });
  }
  async page(guildId:string,userId:string,channelId?:string):Promise<TutorialPage|null> {
    tutorialIdSchema.parse(guildId); tutorialIdSchema.parse(userId);
    if (channelId!==undefined) tutorialIdSchema.parse(channelId);
    return this.limited(async()=>{
      // Fetch live membership/visibility before reading drafts: a step unpublished during the lookup stays private.
      const channels=await this.transport.channels(guildId,userId);
      const steps=new Map(this.store.list(guildId).filter(step=>step.published).map(step=>[step.channelId,step]));
      const pages=channels.flatMap(channel=>{const step=steps.get(channel.id);return step ? [{channel,step}] : [];});
      const index=channelId===undefined ? 0 : pages.findIndex(page=>page.channel.id===channelId);
      if (index<0) throw new TutorialError(404,'This tutorial step is no longer available. Start /tutorial again.');
      if (!pages.length) return null;
      return {...pages[index],index,total:pages.length,previousChannelId:pages[index-1]?.channel.id??null,nextChannelId:pages[index+1]?.channel.id??null};
    });
  }
}
