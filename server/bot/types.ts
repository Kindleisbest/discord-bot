export type BotStatus = { state:'not_configured'|'connecting'|'ready'|'disconnected'; lastReadyAt:number|null };
export type SendableChannel = { id:string; name:string; type:0|5 };
export type SendMessageInput = { guildId:string; channelId:string; content:string; nonce:string };
export interface BotService {
  status():BotStatus;
  listSendableChannels(guildId:string):Promise<SendableChannel[]>;
  sendMessage(input:SendMessageInput):Promise<{id:string;channelId:string}>;
  stop():Promise<void>;
}
export class BotUnavailableError extends Error {}
export class BotSendError extends Error {
  constructor(message:string,readonly uncertain:boolean) {super(message);}
}
