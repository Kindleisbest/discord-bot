export type InstagramChannel = {id:string;name:string};
export type InstagramOptions = {sourceChannels:InstagramChannel[];destinationChannels:InstagramChannel[]};
export type InstagramSettingsInput = {
  sourceChannelIds:string[];destinationChannelId:string|null;
  embedTitle:string;embedDescription:string;embedColor:string;expectedRevision:number;
};
export type InstagramSettings = Omit<InstagramSettingsInput,'expectedRevision'> & {
  enabled:false;revision:number;updatedAt:number|null;
};
export class InstagramError extends Error {
  constructor(public statusCode:number,message:string) {super(message);}
}
