import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { randomToken, constantEqual } from './crypto.js';
import { DiscordError, type DiscordApi } from './discord.js';
import { Store, type SessionData } from './store.js';
import { assertGrantChange, resolveAccess } from './permissions.js';
import { PERMISSIONS, type Permission } from '../shared/permissions.js';
import { BotUnavailableError, type BotService } from './bot/types.js';
import { deliverMessage, DeliveryConflictError, publicDelivery } from './messages.js';
import { InboxError } from '../shared/inbox.js';
import type { InboxService } from './inbox/service.js';

class HttpError extends Error { constructor(readonly statusCode:number,message:string) { super(message); } }
const snowflake = z.string().regex(/^\d{17,20}$/);
export async function buildApp(config:Config,store:Store,discord:DiscordApi,bot?:BotService,inbox?:InboxService) {
  const app = Fastify({logger:false,trustProxy:false,bodyLimit:16_384,requestTimeout:30_000});
  const sessionCookie = config.production ? '__Host-dm_session' : 'dm_session';
  const stateCookie = config.production ? '__Host-dm_oauth' : 'dm_oauth';
  const cookieOptions = {httpOnly:true,secure:config.production,sameSite:'lax' as const,path:'/'};
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https://cdn.discordapp.com'],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:config.production ? [] : null}},
    hsts:config.production ? {maxAge:31536000,includeSubDomains:true} : false,
    referrerPolicy:{policy:'no-referrer'},
  });
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  function session(request:FastifyRequest):SessionData {
    const data = store.getSession(request.cookies[sessionCookie] ?? '');
    if (!data) throw new HttpError(401,'Sign in with Discord to continue.');
    return data;
  }
  async function context(request:FastifyRequest,permission?:Permission) {
    const data = session(request);
    const {guildId} = z.object({guildId:snowflake}).parse(request.params);
    const current = await discord.guildContext(guildId,data.user.id);
    const input = {guildId,ownerId:current.guild.ownerId,userId:data.user.id,memberRoleIds:current.memberRoleIds,roles:current.roles,grants:store.getGrants(guildId)};
    const access = resolveAccess(input);
    if (!access.allowed || (permission && !access.permissions.includes(permission))) throw new HttpError(403,'You do not have access to this server or action.');
    return {data,input,access,...current};
  }
  app.addHook('onRequest',async (request,reply)=>{
    reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/') || request.url.startsWith('/auth/')) reply.header('Cache-Control','no-store');
    if (['POST','PUT','PATCH','DELETE'].includes(request.method)) {
      if (request.headers.origin !== config.APP_ORIGIN) throw new HttpError(403,'Request origin was not accepted.');
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403,'Cross-site requests are not accepted.');
      const data = session(request);
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !constantEqual(csrf,data.csrfToken)) throw new HttpError(403,'Refresh the page before trying again.');
    }
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof InboxError)return reply.code(error.statusCode).send({error:error.message});
    if(error instanceof BotUnavailableError)return reply.code(503).send({error:'The bot is offline. Wait for it to reconnect before sending.'});
    if(error instanceof DeliveryConflictError)return reply.code(409).send({error:error.message});
    if (error instanceof z.ZodError) return reply.code(400).send({error:'Check the request fields and try again.'});
    if (error instanceof DiscordError) {
      if (error.status === 401) {
        store.deleteSession(request.cookies[sessionCookie] ?? '');
        reply.clearCookie(sessionCookie,cookieOptions);
        return reply.code(401).send({error:'Discord authorization expired. Sign in again.'});
      }
      if (error.status === 403 || error.status === 404) return reply.code(403).send({error:'Discord could not verify your access to this server.'});
      return reply.code(503).send({error:'Discord is temporarily unavailable. Access stays locked until it can be verified.'});
    }
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.code(status >= 400 && status < 600 ? status : 500).send({error:error instanceof HttpError ? error.message : status === 429 ? 'Too many requests. Please wait a minute.' : status === 413 ? 'This request is too large.' : 'The request could not be completed.'});
  });
  app.get('/healthz',async()=>({ok:true}));
  app.get('/api/status',async()=>({configured:config.configured,service:'discord-bot',stage:3}));
  app.get('/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request,reply)=>{
    if (!config.configured) throw new HttpError(503,'Discord sign-in has not been configured yet.');
    const state=randomToken(), binding=randomToken();
    store.createState(state,binding);
    reply.setCookie(stateCookie,binding,{...cookieOptions,maxAge:600});
    return reply.redirect(discord.authorizeUrl(state));
  });
  app.get('/auth/callback',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(request,reply)=>{
    reply.clearCookie(stateCookie,cookieOptions);
    const query = z.object({state:z.string().min(20).max(200),code:z.string().min(1).max(2000).optional(),error:z.string().max(200).optional()}).parse(request.query);
    if (!store.consumeState(query.state,request.cookies[stateCookie] ?? '')) throw new HttpError(400,'This sign-in link expired or was already used. Start sign-in again.');
    if (query.error || !query.code) return reply.redirect('/?login=cancelled');
    const token = await discord.exchange(query.code);
    const user = await discord.currentUser(token.accessToken);
    const hints = (await discord.userGuilds(token.accessToken)).filter(g=>g.owner || (BigInt(g.permissions)&8n)===8n);
    let admitted = false;
    for (const hint of hints) {
      try {
        const live = await discord.guildContext(hint.id,user.id);
        if (resolveAccess({guildId:hint.id,userId:user.id,ownerId:live.guild.ownerId,memberRoleIds:live.memberRoleIds,roles:live.roles,grants:store.getGrants(hint.id)}).allowed) { admitted=true; break; }
      } catch(error) { if (!(error instanceof DiscordError) || ![403,404].includes(error.status)) throw error; }
    }
    if (!admitted) {
      await discord.revoke(token.accessToken).catch(()=>{});
      throw new HttpError(403,'You need Administrator permission, or server ownership, in a server where this bot is installed.');
    }
    const old = request.cookies[sessionCookie]; if (old) store.deleteSession(old);
    const created=store.createSession({user,accessToken:token.accessToken},token.expiresIn*1000);
    reply.setCookie(sessionCookie,created.id,{...cookieOptions,maxAge:Math.floor((created.expiresAt-Date.now())/1000)});
    return reply.redirect('/');
  });
  app.post('/auth/logout',async(request,reply)=>{
    const data = session(request);
    store.deleteSession(request.cookies[sessionCookie] ?? '');
    reply.clearCookie(sessionCookie,cookieOptions);
    await discord.revoke(data.accessToken).catch(()=>{});
    return {ok:true};
  });
  app.get('/api/me',async(request)=>{
    const data=session(request);
    return {user:data.user,csrfToken:data.csrfToken,onboarding:store.getOnboarding(data.user.id)};
  });
  app.get('/api/guilds',async(request)=>{
    const data=session(request);
    const candidates=(await discord.userGuilds(data.accessToken)).filter(g=>g.owner || (BigInt(g.permissions)&8n)===8n);
    const guilds=[];
    // Sequential verification respects Discord rate limits on a small Pi.
    for (const candidate of candidates) {
      try {
        const live=await discord.guildContext(candidate.id,data.user.id);
        const access=resolveAccess({guildId:candidate.id,userId:data.user.id,ownerId:live.guild.ownerId,memberRoleIds:live.memberRoleIds,roles:live.roles,grants:store.getGrants(candidate.id)});
        if (access.allowed) guilds.push({id:live.guild.id,name:live.guild.name,icon:live.guild.icon,isOwner:access.isOwner});
      } catch(error) { if (!(error instanceof DiscordError) || ![403,404].includes(error.status)) throw error; }
    }
    return {guilds};
  });
  app.get('/api/guilds/:guildId',async(request)=>{
    const c=await context(request);
    const canManage=c.access.permissions.includes('permissions.manage');
    const editableRoleIds=canManage ? c.roles.filter(role=>{
      try {assertGrantChange(c.input,role.id,c.input.grants.find(g=>g.roleId===role.id)?.permissions ?? []);return true;} catch{return false;}
    }).map(r=>r.id) : [];
    return {guild:c.guild,access:c.access,memberRoleIds:c.memberRoleIds,roles:canManage ? c.roles : [],grants:canManage ? c.input.grants : [],editableRoleIds};
  });
  app.get('/api/guilds/:guildId/activity',async(request)=>{
    const c=await context(request,'activity.view'); return {activity:store.getActivity(c.guild.id)};
  });
  app.get('/api/guilds/:guildId/channels',async(request)=>{
    const c=await context(request,'messages.send');
    if(!bot || bot.status().state!=='ready')return {channels:[],bot:bot?.status() ?? {state:'not_configured',lastReadyAt:null}};
    return {channels:await bot.listSendableChannels(c.guild.id),bot:bot.status()};
  });
  app.post('/api/guilds/:guildId/messages',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(request)=>{
    const c=await context(request,'messages.send');
    const body=z.object({channelId:snowflake,content:z.string().trim().min(1).max(2000),requestId:z.string().uuid()}).strict().parse(request.body);
    if(!bot)throw new BotUnavailableError();
    const delivery=await deliverMessage(store,bot,{...body,guildId:c.guild.id,actorId:c.data.user.id});
    return {delivery:publicDelivery(delivery)};
  });
  app.get('/api/guilds/:guildId/messages/:requestId',async(request)=>{
    const c=await context(request,'messages.send');
    const {requestId}=z.object({requestId:z.string().uuid()}).parse(request.params);
    const delivery=store.getDelivery(c.guild.id,requestId);
    if(!delivery || (delivery.actorId!==c.data.user.id && !c.access.isOwner))throw new HttpError(404,'That delivery was not found.');
    return {delivery:publicDelivery(delivery)};
  });
  app.put('/api/guilds/:guildId/permissions/:roleId',async(request)=>{
    const c=await context(request,'permissions.manage');
    const {roleId}=z.object({roleId:snowflake}).parse(request.params);
    const {permissions}=z.object({permissions:z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length)}).strict().parse(request.body);
    try {assertGrantChange(c.input,roleId,permissions);} catch(error) {throw new HttpError(403,error instanceof Error ? error.message : 'Permission change denied.');}
    store.setGrant(c.guild.id,roleId,permissions,c.data.user.id);
    return {ok:true};
  });
  app.post('/api/onboarding',async(request)=>{
    const data=session(request);
    const body=z.object({completed:z.boolean(),step:z.number().int().min(0).max(5)}).strict().parse(request.body);
    store.setOnboarding(data.user.id,body.completed,body.step); return {ok:true};
  });
  function staffInbox() {if(!inbox)throw new HttpError(503,'The staff inbox is not available.');return inbox;}
  app.get('/api/guilds/:guildId/inbox',async request=>{
    const c=await context(request);
    const canRead=c.access.permissions.includes('inbox.read');
    if(!canRead && !c.access.permissions.includes('settings.manage'))throw new HttpError(403,'Staff inbox access is required.');
    const query=z.object({status:z.enum(['open','closed']).default('open'),offset:z.coerce.number().int().min(0).max(100000).default(0)}).parse(request.query);
    const service=staffInbox();
    return {settings:service.persistence.getSettings(c.guild.id),...(canRead ? service.persistence.listTickets(c.guild.id,query.status,query.offset) : {tickets:[],nextOffset:null})};
  });
  app.put('/api/guilds/:guildId/inbox/settings',async request=>{
    const c=await context(request,'settings.manage');
    const {enabled}=z.object({enabled:z.boolean()}).strict().parse(request.body);
    staffInbox().configure(c.guild.id,c.data.user.id,enabled);return {ok:true};
  });
  app.get('/api/guilds/:guildId/inbox/:ticketId',async request=>{
    const c=await context(request,'inbox.read');
    const {ticketId}=z.object({ticketId:z.string().uuid()}).parse(request.params);
    const {before}=z.object({before:z.coerce.number().int().positive().optional()}).parse(request.query);
    const persistence=staffInbox().persistence;
    const ticket=persistence.getTicket(c.guild.id,ticketId);
    if(!ticket)throw new HttpError(404,'This conversation was not found.');
    return {ticket,...persistence.listMessages(c.guild.id,ticketId,before)};
  });
  app.post('/api/guilds/:guildId/inbox/:ticketId/replies',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const c=await context(request,'inbox.reply');
    if(!c.access.permissions.includes('inbox.read'))throw new HttpError(403,'Reading the staff inbox is also required to reply.');
    const {ticketId}=z.object({ticketId:z.string().uuid()}).parse(request.params);
    const body=z.object({content:z.string().trim().min(1).max(2000),requestId:z.string().uuid()}).strict().parse(request.body);
    return {message:await staffInbox().reply(c.guild.id,ticketId,c.data.user.id,body.requestId,body.content)};
  });
  app.get('/api/guilds/:guildId/inbox/:ticketId/replies/:requestId',async request=>{
    const c=await context(request,'inbox.read');
    const params=z.object({ticketId:z.string().uuid(),requestId:z.string().uuid()}).parse(request.params);
    const message=staffInbox().persistence.getReply(c.guild.id,params.ticketId,params.requestId);
    if(!message)throw new HttpError(404,'That reply was not found.');return {message};
  });
  app.post('/api/guilds/:guildId/inbox/:ticketId/close',async request=>{
    const c=await context(request,'inbox.reply');
    if(!c.access.permissions.includes('inbox.read'))throw new HttpError(403,'Reading the staff inbox is also required to close a conversation.');
    const {ticketId}=z.object({ticketId:z.string().uuid()}).parse(request.params);
    z.object({}).strict().parse(request.body);
    staffInbox().close(c.guild.id,ticketId,c.data.user.id);return {ok:true};
  });
  const webRoot=resolve('dist/web');
  if (existsSync(resolve(webRoot,'index.html'))) {
    await app.register(staticFiles,{root:webRoot,index:'index.html',dotfiles:'deny'});
    app.setNotFoundHandler((request,reply)=>{
      if (request.method==='GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/auth/') && !request.url.startsWith('/assets/')) return reply.sendFile('index.html');
      return reply.code(404).send({error:'Not found.'});
    });
  }
  return app;
}
