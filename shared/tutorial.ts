export interface TutorialChannel {id:string;name:string;type:number;position:number}
export interface TutorialStep {channelId:string;title:string;body:string;published:boolean;revision:number;updatedAt:number|null}
export interface TutorialStepInput {title:string;body:string;published:boolean;expectedRevision:number}
export interface TutorialPage {channel:TutorialChannel;step:TutorialStep;index:number;total:number;previousChannelId:string|null;nextChannelId:string|null}
export class TutorialError extends Error {constructor(public statusCode:number,message:string){super(message);}}
