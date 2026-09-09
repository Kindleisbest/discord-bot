import { z } from 'zod';
import type { Config } from './config.js';
import type { DiscordRole } from './permissions.js';

const id = z.string().regex(/^\d{17,20}$/);
const userSchema = z.object({ id, username:z.string(), avatar:z.string().nullable() });
const guildSchema = z.object({id,name:z.string(),icon:z.string().nullable(),owner_id:id});
const roleSchema = z.object({id,name:z.string(),position:z.number().int(),permissions:z.string().regex(/^\d+$/),managed:z.boolean().optional()});
const memberSchema = z.object({user:userSchema,roles:z.array(id)});
const userGuildSchema = z.object({id,name:z.string(),icon:z.string().nullable(),owner:z.boolean(),permissions:z.string().regex(/^\d+$/)});
export type DiscordUser = z.infer<typeof userSchema>;
export type DiscordGuild = {id:string;name:string;icon:string|null;ownerId:string};
export type UserGuild = z.infer<typeof userGuildSchema>;
export interface DiscordApi {
  authorizeUrl(state:string):string;
  exchange(code:string):Promise<{accessToken:string;expiresIn:number}>;
  currentUser(accessToken:string):Promise<DiscordUser>;
  userGuilds(accessToken:string):Promise<UserGuild[]>;
  guildContext(guildId:string,userId:string):Promise<{guild:DiscordGuild;roles:DiscordRole[];memberRoleIds:string[]}>;
  revoke(accessToken:string):Promise<void>;
}
export class DiscordError extends Error {
  constructor(public readonly status: number) { super('Discord could not verify this request.'); }
}
export class DiscordHttpApi implements DiscordApi {
  constructor(private readonly config:Config, private readonly fetcher:typeof fetch = fetch) {}
  private async request(path:string, authorization:string, init:RequestInit = {}):Promise<unknown> {
    const response = await this.fetcher(`https://discord.com/api/v10${path}`, {
      ...init, redirect:'error', signal:AbortSignal.timeout(10_000),
      headers:{ Authorization:authorization, 'User-Agent':'DiscordBot (https://github.com/Kindleisbest/discord-bot, 0.1.0)', ...init.headers }
    });
    if (!response.ok) throw new DiscordError(response.status);
    return response.status === 204 ? null : response.json();
  }
  authorizeUrl(state:string) {
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({client_id:this.config.DISCORD_CLIENT_ID,redirect_uri:`${this.config.APP_ORIGIN}/auth/callback`,response_type:'code',scope:'identify guilds',state,prompt:'consent'}).toString();
    return url.toString();
  }
  async exchange(code:string) {
    const response = await this.fetcher('https://discord.com/api/v10/oauth2/token', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10_000),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.config.DISCORD_CLIENT_ID,client_secret:this.config.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:`${this.config.APP_ORIGIN}/auth/callback`})
    });
    if (!response.ok) throw new DiscordError(response.status);
    const result = z.object({access_token:z.string().min(1),expires_in:z.number().positive(),scope:z.string(),token_type:z.literal('Bearer')}).parse(await response.json());
    if (!['identify','guilds'].every(scope=>result.scope.split(' ').includes(scope))) throw new DiscordError(403);
    return {accessToken:result.access_token,expiresIn:result.expires_in};
  }
  async currentUser(token:string) { return userSchema.parse(await this.request('/users/@me',`Bearer ${token}`)); }
  async userGuilds(token:string) {
    const result:UserGuild[] = [];
    let after = '0';
    // Discord limits user guilds; paginate rather than silently losing a server.
    for (let page=0;page<10;page++) {
      const rows = z.array(userGuildSchema).parse(await this.request(`/users/@me/guilds?limit=200&after=${after}`,`Bearer ${token}`));
      result.push(...rows);
      if (rows.length < 200) return result;
      after = rows[rows.length-1].id;
    }
    throw new DiscordError(503);
  }
  async guildContext(guildId:string,userId:string) {
    id.parse(guildId); id.parse(userId);
    const auth = `Bot ${this.config.DISCORD_BOT_TOKEN}`;
    const [guildRaw,rolesRaw,memberRaw] = await Promise.all([
      this.request(`/guilds/${guildId}`,auth), this.request(`/guilds/${guildId}/roles`,auth), this.request(`/guilds/${guildId}/members/${userId}`,auth)
    ]);
    const guild = guildSchema.parse(guildRaw), member = memberSchema.parse(memberRaw);
    if (guild.id !== guildId || member.user.id !== userId) throw new DiscordError(403);
    return {guild:{id:guild.id,name:guild.name,icon:guild.icon,ownerId:guild.owner_id},roles:z.array(roleSchema).parse(rolesRaw),memberRoleIds:member.roles};
  }
  async revoke(token:string) {
    const result = await this.fetcher('https://discord.com/api/v10/oauth2/token/revoke', {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.config.DISCORD_CLIENT_ID,client_secret:this.config.DISCORD_CLIENT_SECRET,token,token_type_hint:'access_token'})
    });
    if (!result.ok) throw new DiscordError(result.status);
  }
}
