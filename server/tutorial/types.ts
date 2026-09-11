import type {TutorialChannel,TutorialPage} from '../../shared/tutorial.js';
export interface TutorialTransport {
  channels(guildId:string,userId?:string):Promise<TutorialChannel[]>;
}
export interface TutorialGatewayService {
  page(guildId:string,userId:string,channelId?:string):Promise<TutorialPage|null>;
}
