export type LevelingMember = {
  guildId:string;memberId:string;status:'active'|'departed'|'opted_out';
  totalXp:string|null;lastAwardAt:number|null;joinedAt:number|null;leftAt:number|null;expiresAt:number|null;
};
export type LevelingAward = {
  guildId:string;memberId:string;source:'message'|'reaction'|'voice';
  eventId:string;occurredAt:number;sourceCreatedAt:number;
};
export type LevelingAwardResult = {
  awarded:boolean;reason:'awarded'|'disabled'|'not_active'|'duplicate'|'cooldown'|'expired'|'capacity';
  member:LevelingMember|null;
};
export class LevelingMemberError extends Error {
  constructor(public statusCode:number,message:string){super(message);}
}
