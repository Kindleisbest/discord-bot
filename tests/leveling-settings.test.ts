import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Vault} from '../server/crypto.js';
import {Store} from '../server/store.js';
import {LevelingSettingsStore, levelingSettingsSchema, LEVELING_SETTINGS_REASON_RETENTION_MS} from '../server/leveling/settings.js';
import {LevelingSettingsError, type LevelingSettingsInput} from '../shared/leveling-settings.js';

const ga = '11111111111111111', gb = '22222222222222222';
const actor = '33333333333333333', role = '44444444444444444', channel = '55555555555555555';
const reason = 'Adjust participation settings for our community.';
const input = (patch: Partial<LevelingSettingsInput> = {}): LevelingSettingsInput => ({
  enabled: true, xpPerAward: 10, cooldownSeconds: 30,
  excludedChannelIds: [], excludedRoleIds: [], roleMilestones: [],
  announcementChannelId: null, announcementPing: false,
  expectedRevision: 0, reason, ...patch,
});
const ids = (count: number) => Array.from({length: count}, (_, index) => String(10000000000000000n + BigInt(index)));
function fixture(path = ':memory:', key = randomBytes(32).toString('base64')) {
  const vault = new Vault(key), base = new Store(path, vault);
  const store = new LevelingSettingsStore(base.db, vault, (...args) => base.addActivity(...args));
  return {key, vault, base, store};
}
type ReasonRow = {guild_id: string; actor_id: string; revision: number; created_at: number; payload: string};
const reasonRows = (base: Store) => base.db.prepare('SELECT * FROM leveling_settings_reasons ORDER BY guild_id,revision').all() as ReasonRow[];
const reasonContext = (row: ReasonRow) => `leveling-settings-reason:${JSON.stringify([row.guild_id, row.actor_id, row.revision, row.created_at])}`;
const unreadable = (error: unknown) => error instanceof LevelingSettingsError && error.statusCode === 500 && error.message === 'These leveling settings could not be read securely.';

test('new guild settings have the agreed enabled defaults, no daily cap, and independent arrays', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.store.get(ga), {
      enabled: true, xpPerAward: 10, cooldownSeconds: 30,
      excludedChannelIds: [], excludedRoleIds: [], roleMilestones: [],
      announcementChannelId: null, announcementPing: false, revision: 0, updatedAt: null,
    });
    const first = f.store.get(ga);
    first.excludedChannelIds.push(channel); first.excludedRoleIds.push(role);
    first.roleMilestones.push({level: '1', roleId: role});
    assert.deepEqual(f.store.get(ga), f.store.get(gb));
    assert.equal(f.store.get(ga).excludedChannelIds.length, 0);
    assert.equal(reasonRows(f.base).length, 0);
  } finally { f.base.close(); }
});

test('settings reject unknown fields, invalid values, ambiguous levels, and duplicate identities', () => {
  const invalid: Record<string, unknown>[] = [
    {enabled: 'true'}, {announcementPing: 1}, {dailyXpCap: 1200},
    {xpPerAward: 0}, {xpPerAward: 1.5}, {xpPerAward: 1_000_001}, {xpPerAward: Infinity},
    {cooldownSeconds: 0}, {cooldownSeconds: 1.5}, {cooldownSeconds: 86_401},
    {expectedRevision: -1}, {expectedRevision: 0.5}, {expectedRevision: Number.MAX_SAFE_INTEGER},
    {reason: '  '}, {reason: 'r'.repeat(501)},
    {announcementChannelId: 'invalid'}, {excludedChannelIds: ['invalid']}, {excludedRoleIds: ['invalid']},
    {excludedChannelIds: [channel, channel]}, {excludedRoleIds: [role, role]},
    {excludedChannelIds: ids(501)}, {excludedRoleIds: ids(251)},
    {roleMilestones: ids(101).map((roleId, index) => ({level: String(index + 1), roleId}))},
    {roleMilestones: [{level: '1', roleId: role}, {level: '1', roleId: channel}]},
    {roleMilestones: [{level: '1', roleId: role}, {level: '2', roleId: role}]},
    {roleMilestones: [{level: '1', roleId: 'bad'}]},
    {roleMilestones: [{level: '1', roleId: role, permissions: 'administrator'}]},
  ];
  for (const level of ['0', '-1', '+1', '01', '1.0', '1e3', ' 1', '1 ', '1'.repeat(101), 1, null]) {
    invalid.push({roleMilestones: [{level, roleId: role}]});
  }
  for (const patch of invalid) assert.equal(levelingSettingsSchema.safeParse({...input(), ...patch}).success, false, JSON.stringify(patch));
  const parsed = levelingSettingsSchema.parse(input({
    xpPerAward: 1_000_000, cooldownSeconds: 86_400, expectedRevision: Number.MAX_SAFE_INTEGER - 1,
    excludedChannelIds: ids(500), excludedRoleIds: ids(250),
    roleMilestones: ids(100).map((roleId, index) => ({level: String(index + 1), roleId})),
    reason: `  ${'r'.repeat(500)}  `,
  }));
  assert.equal(parsed.reason.length, 500);
  assert.equal(levelingSettingsSchema.parse(input({xpPerAward: 1, cooldownSeconds: 1})).xpPerAward, 1);
});

test('settings and reasons are encrypted separately, guild isolated, and huge milestone levels remain exact', () => {
  const f = fixture();
  try {
    const hugeLevel = '9'.repeat(100);
    const saved = f.store.save(ga, actor, input({
      excludedChannelIds: [channel], excludedRoleIds: [role],
      roleMilestones: [{level: hugeLevel, roleId: role}], reason: `  ${reason}  `,
    }));
    assert.equal(saved.revision, 1);
    assert.equal(saved.roleMilestones[0].level, hugeLevel);
    assert.equal('reason' in saved, false); assert.equal('expectedRevision' in saved, false);
    assert.deepEqual(f.store.get(ga), saved); assert.equal(f.store.get(gb).revision, 0);
    const raw = f.base.db.prepare('SELECT * FROM leveling_settings').get() as {payload: string};
    assert.equal(raw.payload.includes(hugeLevel), false); assert.equal(raw.payload.includes(channel), false);
    const records = reasonRows(f.base);
    assert.equal(records.length, 1); assert.equal(records[0].payload.includes(reason), false);
    assert.deepEqual(f.vault.open(records[0].payload, reasonContext(records[0])), {reason});
    const activity = f.base.getActivity(ga);
    assert.equal(activity.length, 1); assert.equal(activity[0].action, 'leveling.settings_saved');
    assert.equal(JSON.stringify(activity).includes(reason), false);
    // Mutating a response must not change the saved copy.
    saved.roleMilestones[0].level = '1'; saved.excludedChannelIds.push(ga);
    assert.equal(f.store.get(ga).roleMilestones[0].level, hugeLevel);
    assert.deepEqual(f.store.get(ga).excludedChannelIds, [channel]);
  } finally { f.base.close(); }
});

test('all settings entry points validate identities before changing storage', () => {
  const f = fixture();
  try {
    for (const bad of ['', '1'.repeat(16), '1'.repeat(21), '1234567890123456x']) {
      assert.throws(() => f.store.get(bad));
      assert.throws(() => f.store.removeGuild(bad));
      assert.throws(() => f.store.save(bad, actor, input()));
      assert.throws(() => f.store.save(ga, bad, input()));
    }
    assert.equal(f.store.get(ga).revision, 0); assert.equal(reasonRows(f.base).length, 0);
  } finally { f.base.close(); }
});

test('corrupt or substituted settings fail closed with the same safe message', () => {
  const f = fixture();
  try {
    f.store.save(ga, actor, input());
    const raw = f.base.db.prepare('SELECT * FROM leveling_settings').get() as {guild_id: string; payload: string; revision: number; updated_at: number};
    const replacements = [
      {...raw, guild_id: gb}, {...raw, revision: 2}, {...raw, updated_at: raw.updated_at + 1},
      {...raw, payload: 'corrupt private data'},
      {...raw, payload: f.vault.seal({enabled: true}, `leveling-settings:${JSON.stringify([ga, 1, raw.updated_at])}`)},
    ];
    for (const changed of replacements) {
      f.base.db.prepare('DELETE FROM leveling_settings').run();
      f.base.db.prepare('INSERT INTO leveling_settings VALUES(?,?,?,?)').run(changed.guild_id, changed.payload, changed.revision, changed.updated_at);
      assert.throws(() => f.store.get(changed.guild_id), unreadable);
      assert.throws(() => f.store.save(changed.guild_id, actor, input()), unreadable);
      assert.equal(reasonRows(f.base).length, 1);
    }
  } finally { f.base.close(); }
});

test('reason authentication binds guild, actor, revision, timestamp, and encrypted payload', () => {
  const f = fixture();
  try {
    f.store.save(ga, actor, input());
    const row = reasonRows(f.base)[0];
    for (const changed of [
      {...row, guild_id: gb}, {...row, actor_id: role}, {...row, revision: 2},
      {...row, created_at: row.created_at + 1}, {...row, payload: 'corrupt'},
    ]) assert.throws(() => f.vault.open(changed.payload, reasonContext(changed)));
  } finally { f.base.close(); }
});

test('stale saves and failed activity writes roll back settings, reasons, and administration activity together', () => {
  const f = fixture();
  try {
    f.store.save(ga, actor, input());
    const otherWriter = new LevelingSettingsStore(f.base.db, f.vault, (...args) => f.base.addActivity(...args));
    const oldRevision = otherWriter.get(ga).revision;
    f.store.save(ga, actor, input({expectedRevision: oldRevision, xpPerAward: 15}));
    assert.throws(() => otherWriter.save(ga, actor, input({expectedRevision: oldRevision, xpPerAward: 20})),
      (error: unknown) => error instanceof LevelingSettingsError && error.statusCode === 409);
    const broken = new LevelingSettingsStore(f.base.db, f.vault, (...args) => {
      f.base.addActivity(...args); throw new Error('Fixture activity write failed.');
    });
    assert.throws(() => broken.save(ga, actor, input({expectedRevision: 2, xpPerAward: 25})));
    assert.throws(() => broken.save(gb, actor, input()));
    assert.equal(f.store.get(ga).revision, 2); assert.equal(f.store.get(ga).xpPerAward, 15);
    assert.equal(f.store.get(gb).revision, 0); assert.equal(reasonRows(f.base).length, 2);
    assert.equal(f.base.getActivity(ga).length, 2); assert.equal(f.base.getActivity(gb).length, 0);
  } finally { f.base.close(); }
});

test('revision arithmetic preserves the final safe integer and rejects further saves', () => {
  const f = fixture();
  try {
    const {reason: _reason, expectedRevision: _expectedRevision, ...content} = input();
    const revision = Number.MAX_SAFE_INTEGER - 1, updatedAt = Date.now();
    f.base.db.prepare('INSERT INTO leveling_settings VALUES(?,?,?,?)').run(ga,
      f.vault.seal(content, `leveling-settings:${JSON.stringify([ga, revision, updatedAt])}`), revision, updatedAt);
    assert.equal(f.store.save(ga, actor, input({expectedRevision: revision})).revision, Number.MAX_SAFE_INTEGER);
    assert.equal(f.store.get(ga).revision, Number.MAX_SAFE_INTEGER);
    assert.throws(() => f.store.save(ga, actor, input({expectedRevision: Number.MAX_SAFE_INTEGER})));
  } finally { f.base.close(); }
});

test('reason records expire exactly at 90 days while saved configuration remains', () => {
  const f = fixture();
  try {
    const saved = f.store.save(ga, actor, input({xpPerAward: 17}));
    const expiresAt = saved.updatedAt! + LEVELING_SETTINGS_REASON_RETENTION_MS;
    f.store.prune(expiresAt - 1); assert.equal(reasonRows(f.base).length, 1);
    f.store.prune(expiresAt); assert.equal(reasonRows(f.base).length, 0);
    assert.deepEqual(f.store.get(ga), saved);
    for (const now of [-1, 0.5, Infinity, NaN]) assert.throws(() => f.store.prune(now));
  } finally { f.base.close(); }
});

test('settings survive a disk reopen, reject a different key, and guild cleanup removes only its records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'discord-leveling-settings-'));
  const path = join(directory, 'test.sqlite');
  let base: Store | undefined;
  try {
    const original = fixture(path); base = original.base;
    const saved = original.store.save(ga, actor, input({enabled: false, roleMilestones: [{level: '9007199254740993', roleId: role}]}));
    original.store.save(gb, actor, input({xpPerAward: 25}));
    original.base.close(); base = undefined;
    const reopened = fixture(path, original.key); base = reopened.base;
    assert.deepEqual(reopened.store.get(ga), saved); assert.equal(reasonRows(base).length, 2);
    const wrongKey = new LevelingSettingsStore(base.db, new Vault(randomBytes(32).toString('base64')), () => {});
    assert.throws(() => wrongKey.get(ga), unreadable);
    reopened.store.removeGuild(ga);
    assert.equal(reopened.store.get(ga).revision, 0); assert.equal(reopened.store.get(gb).xpPerAward, 25);
    assert.deepEqual(reasonRows(base).map(row => row.guild_id), [gb]);
  } finally { base?.close(); rmSync(directory, {recursive: true, force: true}); }
});
