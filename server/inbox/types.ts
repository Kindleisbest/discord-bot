import type { InboxAttachment,InboxMessage,InboxTicket } from '../../shared/inbox.js';
export interface InboxPersistence {
  getSettings(guildId:string):{enabled:boolean};
  setSettings(guildId:string,enabled:boolean):void;
  enabledGuildIds():string[];
  setRoute(userId:string,guildId:string,now?:number):void;
  getRoute(userId:string,now?:number):string|null;
  clearRoute(userId:string):void;
  createChoice(userId:string,guildIds:string[],now?:number):string;
  consumeChoice(token:string,userId:string,guildId:string,now?:number):boolean;
  receive(input:{guildId:string;memberId:string;discordMessageId:string;content:string;attachments:InboxAttachment[];createdAt:number}):{ticket:InboxTicket;message:InboxMessage;created:boolean};
  listTickets(guildId:string,status:'open'|'closed',offset?:number):{tickets:InboxTicket[];nextOffset:number|null};
  getTicket(guildId:string,ticketId:string):InboxTicket|null;
  listMessages(guildId:string,ticketId:string,before?:number):{messages:InboxMessage[];nextBefore:number|null};
  prepareReply(guildId:string,ticketId:string,actorId:string,requestId:string,content:string):{created:boolean;message:InboxMessage};
  getReply(guildId:string,ticketId:string,requestId:string):InboxMessage|null;
  finishReply(guildId:string,ticketId:string,requestId:string,status:'sent'|'failed'|'uncertain',discordMessageId:string|null):InboxMessage;
  closeTicket(guildId:string,ticketId:string):void;
  recoverPendingReplies():void;
  prune(now?:number):void;
  removeGuild(guildId:string):void;
}
export interface InboxTransport {
  eligibleGuilds(userId:string,guildIds:string[]):Promise<{id:string;name:string}[]>;
  verifyMember(guildId:string,userId:string):Promise<{id:string;name:string}>;
  sendReply(input:{guildId:string;memberId:string;content:string;nonce:string}):Promise<{id:string}>;
}
export interface InboxGatewayService {
  contact(guildId:string,userId:string):Promise<{id:string;name:string}>;
  choices(userId:string):Promise<{token:string;guilds:{id:string;name:string}[]}>;
  choose(token:string,userId:string,guildId:string):Promise<{id:string;name:string}>;
  receive(input:{memberId:string;discordMessageId:string;content:string;attachments:InboxAttachment[];createdAt:number}):Promise<{routed:false}|{routed:true;created:boolean;guildName:string;ticketId:string}>;
}
