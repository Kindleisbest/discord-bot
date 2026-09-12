import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import type {Vault} from '../crypto.js';
import {InstagramError,type InstagramSettings,type InstagramSettingsInput,type InstagramOptions} from '../../shared/instagram.js';

export const instagramIdSchema=z.string().regex(/^\d{17,20}$/);
const contentSchema=z.object({
  sourceChannelIds:z.array(instagramIdSchema).max(25).refine(ids=>new Set(ids).size===ids.length),
  destinationChannelId:instagramIdSchema.nullable(),
  embedTitle:z.string().trim().min(1).max(100),
  embedDescription:z.string().trim().max(2000),
  embedColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(color=>color.toUpperCase()),
}).strict().refine(value=>!value.destinationChannelId || !value.sourceChannelIds.includes(value.destinationChannelId));
export const instagramSettingsSchema=contentSchema.safeExtend({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1)});
type Row={guild_id:string;payload:string;revision:number;updated_at:number};
type ActivityHook=(guildId:string,actorId:string,action:string,targetId:string|null)=>void;
function context(row:Omit<Row,'payload'>){return `instagram-settings:${JSON.stringify([row.guild_id,row.revision,row.updated_at])}`;}
function defaults():InstagramSettings{return {sourceChannelIds:[],destinationChannelId:null,embedTitle:'Instagram post shared',embedDescription:'Take a look at this Instagram post.',embedColor:'#5865F2',enabled:false,revision:0,updatedAt:null};}

export class InstagramSettingsStore {
  constructor(private readonly db:DatabaseSync,private readonly vault:Vault,private readonly activity:ActivityHook){
    db.exec('CREATE TABLE IF NOT EXISTS instagram_settings(guild_id TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),updated_at INTEGER NOT NULL) STRICT;');
  }
  get(guildId:string):InstagramSettings {
    const row=this.db.prepare('SELECT * FROM instagram_settings WHERE guild_id=?').get(guildId) as Row|undefined;
    if(!row)return defaults();
    try{return {...contentSchema.parse(this.vault.open(row.payload,context(row))),enabled:false,revision:row.revision,updatedAt:row.updated_at};}
    catch{throw new InstagramError(500,'These Instagram settings could not be read securely.');}
  }
  save(guildId:string,actorId:string,input:InstagramSettingsInput):InstagramSettings {
    const {expectedRevision,...content}=instagramSettingsSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(this.get(guildId).revision!==expectedRevision)throw new InstagramError(409,'These settings changed in another session. Reload the saved version before saving again.');
      const row={guild_id:guildId,revision:expectedRevision+1,updated_at:Date.now()};
      this.db.prepare('INSERT INTO instagram_settings VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at')
        .run(guildId,this.vault.seal(content,context(row)),row.revision,row.updated_at);
      this.activity(guildId,actorId,'instagram.settings_saved',content.destinationChannelId);
      this.db.exec('COMMIT');
      return {...content,enabled:false,revision:row.revision,updatedAt:row.updated_at};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  removeGuild(guildId:string){this.db.prepare('DELETE FROM instagram_settings WHERE guild_id=?').run(guildId);}
}

export interface InstagramSettingsTransport {options(guildId:string):Promise<InstagramOptions>}
export class InstagramSettingsService {
  constructor(readonly store:InstagramSettingsStore,readonly transport:InstagramSettingsTransport){}
  async save(guildId:string,actorId:string,input:InstagramSettingsInput){
    instagramIdSchema.parse(guildId);instagramIdSchema.parse(actorId);
    const validated=instagramSettingsSchema.parse(input);
    const options=await this.transport.options(guildId);
    const sourceIds=new Set(options.sourceChannels.map(channel=>channel.id));
    if(validated.sourceChannelIds.some(id=>!sourceIds.has(id)))throw new InstagramError(400,'A selected source channel is unavailable. Reload channels and review your selection.');
    if(validated.destinationChannelId && !options.destinationChannels.some(channel=>channel.id===validated.destinationChannelId))throw new InstagramError(400,'The destination is unavailable or the bot cannot send embeds there.');
    return this.store.save(guildId,actorId,validated);
  }
}
