import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:3000'),
  HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  DISCORD_BOT_TOKEN: z.string().default(''),
  DATA_ENCRYPTION_KEY: z.string().default(''),
});
const supplied = (value: string) => value.length > 0 && !/^(replace|your_|placeholder)/i.test(value);
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration fields: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const c = parsed.data;
  const url = new URL(c.APP_ORIGIN);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGIN must be an origin with no path, credentials, query, or fragment.');
  const production = c.NODE_ENV === 'production';
  if (production && url.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (!production && (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Development APP_ORIGIN must use loopback HTTP. Use production mode for public hosting.');
  const credentials = [c.DISCORD_CLIENT_ID, c.DISCORD_CLIENT_SECRET, c.DISCORD_BOT_TOKEN, c.DATA_ENCRYPTION_KEY];
  const configured = credentials.every(supplied);
  if (credentials.some(supplied) && !configured) throw new Error('Complete all four Discord/encryption configuration values, or leave all as placeholders.');
  if (configured && !/^\d{17,20}$/.test(c.DISCORD_CLIENT_ID)) throw new Error('DISCORD_CLIENT_ID must be a Discord application ID.');
  if (configured && (!/^[A-Za-z0-9+/]{43}=$/.test(c.DATA_ENCRYPTION_KEY) || Buffer.from(c.DATA_ENCRYPTION_KEY, 'base64').length !== 32)) throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded random 32-byte key.');
  if (production && !configured) throw new Error('Production requires Discord credentials and a data encryption key.');
  return { ...c, APP_ORIGIN: url.origin, configured, production };
}
export type Config = ReturnType<typeof readConfig>;
