import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { PERMISSIONS, type Permission } from '../shared/permissions.js';
import { Vault, randomToken, tokenHash } from './crypto.js';
import type { RoleGrant } from './permissions.js';

const DAY = 86_400_000;
const IDLE_TIMEOUT = 30 * 60_000;
export type SessionData = {user:{id:string;username:string;avatar:string|null};accessToken:string;csrfToken:string};
type SessionRow = {id_hash:string;payload:string;expires_at:number;last_seen:number};
export type Activity = {id:number;actorId:string;action:string;targetId:string|null;createdAt:number};
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, private readonly vault: Vault) {
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
    const version = this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    if (version.user_version > 1) throw new Error('Database is newer than this application.');
    if (version.user_version === 0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE sessions(id_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL) STRICT;
      CREATE TABLE oauth_states(state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE role_grants(guild_id TEXT NOT NULL, role_id TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(guild_id,role_id)) STRICT;
      CREATE TABLE activity(id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL) STRICT;
      CREATE INDEX activity_guild_time ON activity(guild_id,created_at DESC);
      CREATE TABLE onboarding(user_id TEXT PRIMARY KEY, completed INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0) STRICT;
      PRAGMA user_version=1; COMMIT;`);
  }
  createState(state: string, binding: string, now = Date.now()) {
    this.db.prepare('INSERT INTO oauth_states VALUES(?,?,?)').run(tokenHash(state), tokenHash(binding), now + 10 * 60_000);
  }
  consumeState(state: string, binding: string, now = Date.now()): boolean {
    // Atomic single-use consumption binds the OAuth redirect to the initiating browser.
    const row = this.db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND binding_hash=? AND expires_at>? RETURNING state_hash').get(tokenHash(state), tokenHash(binding), now);
    return !!row;
  }
  createSession(data: Omit<SessionData,'csrfToken'>, lifetimeMs: number, now = Date.now()) {
    const id = randomToken(); const hash = tokenHash(id);
    const payload: SessionData = { ...data, csrfToken: randomToken() };
    const expiresAt = now + Math.min(lifetimeMs, 8 * 60 * 60_000);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash, this.vault.seal(payload, `session:${hash}`), expiresAt, now);
    return {id, expiresAt, data:payload};
  }
  getSession(id: string, now = Date.now()): SessionData | null {
    if (!/^[\w-]{43}$/.test(id)) return null;
    const hash = tokenHash(id);
    const row = this.db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(hash) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at <= now || row.last_seen + IDLE_TIMEOUT <= now) { this.deleteSession(id); return null; }
    try {
      const result = this.vault.open<SessionData>(row.payload, `session:${hash}`);
      this.db.prepare('UPDATE sessions SET last_seen=? WHERE id_hash=?').run(now, hash);
      return result;
    } catch { this.deleteSession(id); return null; }
  }
  deleteSession(id: string) { this.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(tokenHash(id)); }
  getGrants(guildId: string): RoleGrant[] {
    const rows = this.db.prepare('SELECT role_id,permissions FROM role_grants WHERE guild_id=?').all(guildId) as {role_id:string;permissions:string}[];
    return rows.map(row => ({roleId:row.role_id, permissions:z.array(z.enum(PERMISSIONS)).parse(JSON.parse(row.permissions))}));
  }
  setGrant(guildId: string, roleId: string, permissions: Permission[], actorId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO role_grants VALUES(?,?,?) ON CONFLICT(guild_id,role_id) DO UPDATE SET permissions=excluded.permissions').run(guildId, roleId, JSON.stringify([...new Set(permissions)]));
      this.addActivity(guildId,actorId,'permissions.updated',roleId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  addActivity(guildId: string, actorId: string, action: string, targetId: string | null = null, now = Date.now()) {
    this.db.prepare('INSERT INTO activity(guild_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?)').run(guildId,actorId,action,targetId,now);
  }
  getActivity(guildId: string, now = Date.now()): Activity[] {
    return this.db.prepare('SELECT id,actor_id AS actorId,action,target_id AS targetId,created_at AS createdAt FROM activity WHERE guild_id=? AND created_at>? ORDER BY created_at DESC,id DESC LIMIT 100').all(guildId, now - 90 * DAY) as Activity[];
  }
  getOnboarding(userId: string) {
    const row = this.db.prepare('SELECT completed,step FROM onboarding WHERE user_id=?').get(userId) as {completed:number;step:number} | undefined;
    return {completed:!!row?.completed,step:row?.step ?? 0};
  }
  setOnboarding(userId: string, completed: boolean, step: number) {
    this.db.prepare('INSERT INTO onboarding VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET completed=excluded.completed,step=excluded.step').run(userId,completed ? 1 : 0,step);
  }
  prune(now = Date.now()) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?').run(now,now-IDLE_TIMEOUT);
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM activity WHERE created_at<=?').run(now-90*DAY);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  close() { this.db.close(); }
}
