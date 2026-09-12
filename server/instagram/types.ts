import type {InstagramDeliveryPayload} from './deliveries.js';
import type {InstagramSettings} from '../../shared/instagram.js';
export type InstagramSourceEvent={guildId:string;sourceChannelId:string;sourceMessageId:string;authorId:string;content:string};
export interface InstagramPostingTransport {
  checkSetup(guildId:string,settings:InstagramSettings):Promise<void>;
  send(guildId:string,payload:InstagramDeliveryPayload,nonce:string,authorize:()=>void):Promise<{id:string}>;
}
export interface InstagramGatewayService {
  accepts(guildId:string,sourceChannelId:string):boolean;
  process(event:InstagramSourceEvent):Promise<void>;
}
