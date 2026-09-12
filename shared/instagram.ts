export type InstagramChannel = {id:string;name:string};
export type InstagramOptions = {sourceChannels:InstagramChannel[];destinationChannels:InstagramChannel[]};
export type InstagramSettingsInput = {
  sourceChannelIds:string[];destinationChannelId:string|null;
  embedTitle:string;embedDescription:string;embedColor:string;expectedRevision:number;
  enabled?:boolean;
};
export type InstagramSettings = Omit<InstagramSettingsInput,'expectedRevision'|'enabled'> & {
  enabled:boolean;revision:number;updatedAt:number|null;
};
export type InstagramRuntime = {available:boolean;botReady:boolean};
export type InstagramDeliverySummary = {
  jobId:string;sourceChannelId:string;destinationChannelId:string;sourceMessageId:string;
  url:string;embedTitle:string;createdAt:number;status:'pending'|'sent'|'failed'|'uncertain';messageId:string|null;
};
export class InstagramError extends Error {
  constructor(public statusCode:number,message:string) {super(message);}
}
