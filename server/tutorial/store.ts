import type { DatabaseSync } from 'node:sqlite';
import { TutorialError, type TutorialStep, type TutorialStepInput } from '../../shared/tutorial.js';
import type { Vault } from '../crypto.js';
import { tutorialContentSchema, tutorialInputSchema } from './validation.js';

type Row = { guild_id:string; channel_id:string; payload:string; revision:number; updated_at:number };
type ActivityHook = (guildId:string,actorId:string,action:string,targetId:string) => void;
function context(row:Omit<Row,'payload'>) {
  return `tutorial-step:${JSON.stringify([row.guild_id,row.channel_id,row.revision,row.updated_at])}`;
}

export class TutorialStore {
  constructor(private readonly db:DatabaseSync, private readonly vault:Vault, private readonly addActivity:ActivityHook) {
    db.exec(`CREATE TABLE IF NOT EXISTS tutorial_steps (
      guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),updated_at INTEGER NOT NULL,
      PRIMARY KEY(guild_id,channel_id)
    ) STRICT;`);
  }
  private decode(row:Row):TutorialStep {
    try {
      return {channelId:row.channel_id, ...tutorialContentSchema.parse(this.vault.open(row.payload,context(row))),
        revision:row.revision,updatedAt:row.updated_at};
    } catch { throw new TutorialError(500,'This tutorial step could not be read securely.'); }
  }
  get(guildId:string,channelId:string):TutorialStep|null {
    const row=this.db.prepare('SELECT * FROM tutorial_steps WHERE guild_id=? AND channel_id=?').get(guildId,channelId) as Row|undefined;
    return row ? this.decode(row) : null;
  }
  list(guildId:string):TutorialStep[] {
    return (this.db.prepare('SELECT * FROM tutorial_steps WHERE guild_id=? ORDER BY channel_id').all(guildId) as Row[]).map(row=>this.decode(row));
  }
  save(guildId:string,channelId:string,actorId:string,input:TutorialStepInput):TutorialStep {
    const {expectedRevision,...content}=tutorialInputSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.get(guildId,channelId);
      if ((previous?.revision ?? 0)!==expectedRevision) throw new TutorialError(409,'Someone changed this step. Reload the saved version before saving again.');
      if (!previous) {
        const count=this.db.prepare('SELECT COUNT(*) AS n FROM tutorial_steps WHERE guild_id=?').get(guildId) as {n:number};
        if (count.n>=1000) throw new TutorialError(409,'This server has reached its saved tutorial step limit.');
      }
      const row={guild_id:guildId,channel_id:channelId,revision:expectedRevision+1,updated_at:Date.now()};
      const payload=this.vault.seal(content,context(row));
      this.db.prepare(`INSERT INTO tutorial_steps VALUES(?,?,?,?,?)
        ON CONFLICT(guild_id,channel_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(guildId,channelId,payload,row.revision,row.updated_at);
      // Clearing is an empty draft with a new revision, so old editors cannot recreate a cleared version.
      this.addActivity(guildId,actorId,content.published ? 'tutorial.published' : 'tutorial.draft_saved',channelId);
      this.db.exec('COMMIT');
      return {channelId,...content,revision:row.revision,updatedAt:row.updated_at};
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  removeGuild(guildId:string) { this.db.prepare('DELETE FROM tutorial_steps WHERE guild_id=?').run(guildId); }
}
