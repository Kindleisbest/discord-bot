import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { readConfig } from './config.js';
import { Vault } from './crypto.js';
import { Store } from './store.js';
import { DiscordHttpApi } from './discord.js';
import { buildApp } from './app.js';

process.umask(0o077);
if (existsSync('.env')) loadEnvFile('.env');
const config=readConfig();
// With no credentials the public setup page is available, but no login/session can be created.
const key=config.configured ? config.DATA_ENCRYPTION_KEY : randomBytes(32).toString('base64');
const store=new Store(config.configured ? resolve(config.DATA_DIR,'discord-bot.sqlite') : ':memory:',new Vault(key));
store.prune();
const app=await buildApp(config,store,new DiscordHttpApi(config));
const cleanup=setInterval(()=>{try {store.prune();} catch {console.error('Scheduled data cleanup failed. Check storage and disk space.');}},60*60_000);
cleanup.unref();
let stopping=false;
async function shutdown() {
  if (stopping) return; stopping=true;
  clearInterval(cleanup);
  await app.close(); store.close();
}
process.once('SIGINT',()=>void shutdown()); process.once('SIGTERM',()=>void shutdown());
await app.listen({host:config.HOST,port:config.PORT});
console.log(`Discord Bot listening locally on ${config.HOST}:${config.PORT}. ${config.configured ? 'Discord sign-in configured.' : 'Setup required; sign-in disabled.'}`);
