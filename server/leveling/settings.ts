import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import type {Vault} from '../crypto.js';
import {LevelingSettingsError, type LevelingSettings, type LevelingSettingsInput} from '../../shared/leveling-settings.js';

export const LEVELING_SETTINGS_REASON_RETENTION_MS = 90 * 86_400_000;
export const levelingIdSchema = z.string().regex(/^\d{17,20}$/);
const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const uniqueIds = (maximum: number) => z.array(levelingIdSchema).max(maximum)
  .refine(ids => new Set(ids).size === ids.length, 'IDs must be unique.');
const contentSchema = z.object({
  enabled: z.boolean(),
  xpPerAward: z.number().int().min(1).max(1_000_000),
  cooldownSeconds: z.number().int().min(1).max(86_400),
  excludedChannelIds: uniqueIds(500),
  excludedRoleIds: uniqueIds(250),
  roleMilestones: z.array(z.object({
    level: z.string().max(100).regex(/^[1-9]\d*$/),
    roleId: levelingIdSchema,
  }).strict()).max(100)
    .refine(milestones => new Set(milestones.map(item => item.level)).size === milestones.length, 'Milestone levels must be unique.')
    .refine(milestones => new Set(milestones.map(item => item.roleId)).size === milestones.length, 'Milestone roles must be unique.'),
  announcementChannelId: levelingIdSchema.nullable(),
  announcementPing: z.boolean(),
}).strict();
export const levelingSettingsSchema = contentSchema.extend({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().min(1).max(500),
}).strict();

const metadataSchema = z.object({
  guild_id: levelingIdSchema,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  updated_at: timestampSchema,
});
type Row = {guild_id: string; payload: string; revision: number; updated_at: number};
type ReasonMetadata = {guild_id: string; actor_id: string; revision: number; created_at: number};
type ActivityHook = (guildId: string, actorId: string, action: string, targetId: string | null) => void;
function settingsContext(row: Omit<Row, 'payload'>): string {
  return `leveling-settings:${JSON.stringify([row.guild_id, row.revision, row.updated_at])}`;
}
function reasonContext(row: ReasonMetadata): string {
  return `leveling-settings-reason:${JSON.stringify([row.guild_id, row.actor_id, row.revision, row.created_at])}`;
}
function defaults(): LevelingSettings {
  return {
    enabled: true, xpPerAward: 10, cooldownSeconds: 30,
    excludedChannelIds: [], excludedRoleIds: [], roleMilestones: [],
    announcementChannelId: null, announcementPing: false, revision: 0, updatedAt: null,
  };
}

/** Persistence only. Callers must separately enforce current Discord access and grants. */
export class LevelingSettingsStore {
  constructor(private readonly db: DatabaseSync, private readonly vault: Vault, private readonly activity: ActivityHook) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS leveling_settings(
        guild_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
        updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN 0 AND 9007199254740991)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS leveling_settings_reasons(
        guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
        created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
        payload TEXT NOT NULL, PRIMARY KEY(guild_id, revision)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS leveling_settings_reasons_expiry ON leveling_settings_reasons(created_at);
    `);
  }

  get(guildId: string): LevelingSettings {
    levelingIdSchema.parse(guildId);
    try {
      const row = this.db.prepare('SELECT * FROM leveling_settings WHERE guild_id=?').get(guildId) as Row | undefined;
      if (!row) return defaults();
      metadataSchema.parse(row);
      const content = contentSchema.parse(this.vault.open(row.payload, settingsContext(row)));
      return {...content, revision: row.revision, updatedAt: row.updated_at};
    } catch {
      throw new LevelingSettingsError(500, 'These leveling settings could not be read securely.');
    }
  }

  save(guildId: string, actorId: string, input: LevelingSettingsInput): LevelingSettings {
    levelingIdSchema.parse(guildId);
    levelingIdSchema.parse(actorId);
    const {expectedRevision, reason, ...content} = levelingSettingsSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.get(guildId).revision !== expectedRevision) {
        throw new LevelingSettingsError(409, 'These settings changed in another session. Reload the saved version before saving again.');
      }
      const row = {guild_id: guildId, revision: expectedRevision + 1, updated_at: timestampSchema.parse(Date.now())};
      this.db.prepare(`INSERT INTO leveling_settings(guild_id,payload,revision,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(guild_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(guildId, this.vault.seal(content, settingsContext(row)), row.revision, row.updated_at);
      const reasonRow = {guild_id: guildId, actor_id: actorId, revision: row.revision, created_at: row.updated_at};
      this.db.prepare('INSERT INTO leveling_settings_reasons(guild_id,actor_id,revision,created_at,payload) VALUES(?,?,?,?,?)')
        .run(guildId, actorId, row.revision, row.updated_at, this.vault.seal({reason}, reasonContext(reasonRow)));
      this.activity(guildId, actorId, 'leveling.settings_saved', null);
      this.db.exec('COMMIT');
      return {...content, revision: row.revision, updatedAt: row.updated_at};
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  removeGuild(guildId: string): void {
    levelingIdSchema.parse(guildId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM leveling_settings_reasons WHERE guild_id=?').run(guildId);
      this.db.prepare('DELETE FROM leveling_settings WHERE guild_id=?').run(guildId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  prune(now = Date.now()): void {
    timestampSchema.parse(now);
    this.db.prepare('DELETE FROM leveling_settings_reasons WHERE created_at<=?').run(now - LEVELING_SETTINGS_REASON_RETENTION_MS);
  }
}
