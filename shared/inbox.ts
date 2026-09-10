export type InboxAttachment={id:string;name:string;url:string;size:number};
export type InboxTicket={id:string;memberId:string;status:'open'|'closed';createdAt:number;updatedAt:number};
export type InboxMessage={id:string;seq:number;ticketId:string;direction:'incoming'|'outgoing';actorId:string;content:string;attachments:InboxAttachment[];status:'received'|'pending'|'sent'|'failed'|'uncertain';discordMessageId:string|null;createdAt:number};
export class InboxError extends Error {constructor(readonly statusCode:number,message:string){super(message);}}
