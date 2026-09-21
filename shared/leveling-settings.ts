export type LevelingRoleMilestone = {
  /** A canonical positive decimal string, kept exact in storage and JSON. */
  level: string;
  roleId: string;
};

export type LevelingSettingsContent = {
  enabled: boolean;
  xpPerAward: number;
  cooldownSeconds: number;
  /** Includes categories; descendants are resolved by the future activity collector. */
  excludedChannelIds: string[];
  excludedRoleIds: string[];
  roleMilestones: LevelingRoleMilestone[];
  announcementChannelId: string | null;
  announcementPing: boolean;
};

export type LevelingSettingsInput = LevelingSettingsContent & {
  expectedRevision: number;
  reason: string;
};

export type LevelingSettings = LevelingSettingsContent & {
  revision: number;
  updatedAt: number | null;
};

export class LevelingSettingsError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
