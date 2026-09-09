import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSIONS, type Permission } from '../shared/permissions.js';
import {
  assertGrantChange, resolveAccess, type DiscordRole, type GuildAccessInput,
} from '../server/permissions.js';

const GUILD = '100000000000000001';
const ADMIN = '200000000000000001';
const LOWER = '200000000000000002';
const HIGHER = '200000000000000003';
const OWNER = '300000000000000001';
const MEMBER = '300000000000000002';

function role(id: string, position: number, permissions = '0'): DiscordRole {
  return { id, name: id === GUILD ? '@everyone' : 'A role', position, permissions };
}

function fixture(overrides: Partial<GuildAccessInput> = {}): GuildAccessInput {
  return {
    guildId: GUILD, ownerId: OWNER, userId: MEMBER, memberRoleIds: [ADMIN],
    roles: [role(GUILD, 0), role(ADMIN, 10, '8'), role(LOWER, 5), role(HIGHER, 20)],
    grants: [], ...overrides,
  };
}

function manager(overrides: Partial<GuildAccessInput> = {}): GuildAccessInput {
  return fixture({
    grants: [{ roleId: ADMIN, permissions: ['permissions.manage', 'messages.send'] }],
    ...overrides,
  });
}

test('the server owner has every website permission without any roles', () => {
  const result = resolveAccess(fixture({ userId: OWNER, memberRoleIds: [], roles: [] }));
  assert.equal(result.allowed, true);
  assert.equal(result.isOwner, true);
  assert.deepEqual(result.permissions, PERMISSIONS);
  assert.equal(result.highestRoleId, null);
});

test('missing identities cannot accidentally trigger the owner exception', () => {
  for (const key of ['guildId', 'ownerId', 'userId'] as const) {
    assert.equal(resolveAccess(fixture({ [key]: '' })).allowed, false);
  }
  assert.equal(resolveAccess(fixture({ ownerId: '', userId: '' })).isOwner, false);
});

test('an administrator starts with activity access only', () => {
  const result = resolveAccess(fixture());
  assert.equal(result.allowed, true);
  assert.equal(result.isOwner, false);
  assert.deepEqual(result.permissions, ['activity.view']);
  assert.equal(result.highestRolePosition, 10);
  assert.equal(result.highestRoleId, ADMIN);
});

test('a role name or Manage Guild permission cannot replace Administrator', () => {
  const input = fixture();
  input.roles[1] = { ...role(ADMIN, 10, '32'), name: 'Administrator' };
  input.grants = [{ roleId: ADMIN, permissions: [...PERMISSIONS] }];
  const result = resolveAccess(input);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.permissions, []);
  assert.match(result.reason, /Administrator/);
});

test('Administrator inherits from everyone using this guild ID', () => {
  const input = fixture({ memberRoleIds: [] });
  input.roles[0].permissions = '8';
  assert.equal(resolveAccess(input).allowed, true);
});

test('large Discord bitfields do not lose precision', () => {
  const input = fixture();
  input.roles[1].permissions = ((1n << 60n) | 8n).toString();
  assert.equal(resolveAccess(input).allowed, true);
  input.roles[1].permissions = (1n << 60n).toString();
  assert.equal(resolveAccess(input).allowed, false);
});

test('missing everyone or foreign guild role data fails closed', () => {
  assert.equal(resolveAccess(fixture({ guildId: '999999999999999999' })).allowed, false);
  const input = fixture();
  input.roles = input.roles.filter(item => item.id !== GUILD);
  input.roles.push({ ...role('999999999999999999', 0, '8'), name: '@everyone' });
  assert.equal(resolveAccess(input).allowed, false);
});

test('missing assigned roles and duplicate role records fail closed', () => {
  assert.equal(resolveAccess(fixture({ memberRoleIds: [ADMIN, 'missing'] })).allowed, false);
  const input = fixture();
  input.roles.push(role(ADMIN, 30, '8'));
  assert.equal(resolveAccess(input).allowed, false);
});

test('invalid Discord permission values and role positions fail closed', () => {
  for (const permissions of ['-1', '8.0', 'NaN', '', '0x8', '8e0', ' 8 ']) {
    const input = fixture();
    input.roles[1].permissions = permissions;
    assert.equal(resolveAccess(input).allowed, false, permissions);
  }
  for (const position of [-1, 0.5, NaN, Infinity]) {
    const input = fixture();
    input.roles[1].position = position;
    assert.equal(resolveAccess(input).allowed, false, String(position));
  }
});

test('website grants union only current held roles and everyone', () => {
  const input = fixture({ grants: [
    { roleId: ADMIN, permissions: ['messages.send', 'activity.view'] },
    { roleId: ADMIN, permissions: ['messages.send', 'inbox.read'] },
    { roleId: GUILD, permissions: ['tutorial.manage'] },
    { roleId: LOWER, permissions: ['permissions.manage'] },
    { roleId: 'deleted', permissions: ['settings.manage'] },
  ] });
  assert.deepEqual(resolveAccess(input).permissions,
    ['activity.view', 'messages.send', 'inbox.read', 'tutorial.manage']);
});

test('unknown stored permission names never become effective permissions', () => {
  const input = fixture({ grants: [{ roleId: ADMIN, permissions: ['future.permission' as Permission] }] });
  assert.deepEqual(resolveAccess(input).permissions, ['activity.view']);
});

test('membership and Administrator removal immediately revoke website access', () => {
  const input = manager();
  assert.equal(resolveAccess(input).allowed, true);
  input.memberRoleIds = [];
  assert.equal(resolveAccess(input).allowed, false);
  input.memberRoleIds = [ADMIN];
  input.roles[1].permissions = '0';
  assert.equal(resolveAccess(input).allowed, false);
});

test('the actual highest member role determines hierarchy even without Administrator on it', () => {
  const input = manager({ memberRoleIds: [ADMIN, HIGHER] });
  assert.equal(resolveAccess(input).highestRoleId, HIGHER);
  input.roles[2].position = 15;
  assert.doesNotThrow(() => assertGrantChange(input, LOWER, ['messages.send']));
});

test('equal positions report the lower snowflake as highest without Number rounding', () => {
  const input = fixture({ memberRoleIds: [ADMIN, LOWER] });
  input.roles[2].position = 10;
  assert.equal(resolveAccess(input).highestRoleId, ADMIN);
  input.roles.reverse();
  assert.equal(resolveAccess(input).highestRoleId, ADMIN);
});

test('only the owner can initially delegate website permission management', () => {
  assert.throws(() => assertGrantChange(fixture(), LOWER, ['activity.view']), /delegated/);
  assert.doesNotThrow(() => assertGrantChange(fixture({ userId: OWNER }), ADMIN, ['permissions.manage']));
});

test('a delegated manager may grant and remove their permissions on a lower role', () => {
  const input = manager();
  assert.doesNotThrow(() => assertGrantChange(input, LOWER, ['messages.send', 'permissions.manage']));
  input.grants.push({ roleId: LOWER, permissions: ['messages.send'] });
  assert.doesNotThrow(() => assertGrantChange(input, LOWER, []));
});

test('a manager cannot grant permissions they do not have', () => {
  assert.throws(() => assertGrantChange(manager(), LOWER, ['settings.manage']), /already have/);
});

test('a manager cannot edit any held role, including a lower held role', () => {
  assert.throws(() => assertGrantChange(manager(), ADMIN, []), /role you hold/);
  assert.throws(() => assertGrantChange(manager({ memberRoleIds: [ADMIN, LOWER] }), LOWER, []), /role you hold/);
});

test('a manager cannot edit everyone or integration roles', () => {
  assert.throws(() => assertGrantChange(manager(), GUILD, []), /@everyone/);
  const input = manager();
  input.roles[2].managed = true;
  assert.throws(() => assertGrantChange(input, LOWER, []), /integration/);
});

test('a manager cannot edit equal or higher roles, even with all website grants', () => {
  const input = manager({ grants: [{ roleId: ADMIN, permissions: [...PERMISSIONS] }] });
  assert.throws(() => assertGrantChange(input, HIGHER, []), /strictly below/);
  input.roles[2].position = 10;
  assert.throws(() => assertGrantChange(input, LOWER, []), /strictly below/);
});

test('protected existing grants cannot be replaced, retained, or deleted by a lesser manager', () => {
  const input = manager();
  input.grants.push({ roleId: LOWER, permissions: ['audit.export'] });
  assert.throws(() => assertGrantChange(input, LOWER, []), /protected/);
  assert.throws(() => assertGrantChange(input, LOWER, ['messages.send']), /protected/);
  assert.throws(() => assertGrantChange(input, LOWER, ['audit.export']), /already have/);
});

test('duplicate and unknown existing grants remain protected during replacement', () => {
  const input = manager();
  input.grants.push({ roleId: LOWER, permissions: ['messages.send'] });
  input.grants.push({ roleId: LOWER, permissions: ['future.permission' as Permission] });
  assert.throws(() => assertGrantChange(input, LOWER, []), /protected/);
});

test('owner may change every real role and override protected grants', () => {
  const input = manager({ userId: OWNER, memberRoleIds: [ADMIN] });
  input.roles[2].managed = true;
  input.grants.push({ roleId: LOWER, permissions: ['audit.export'] });
  for (const id of [GUILD, ADMIN, LOWER, HIGHER]) {
    assert.doesNotThrow(() => assertGrantChange(input, id, [...PERMISSIONS]));
    assert.doesNotThrow(() => assertGrantChange(input, id, []));
  }
});

test('everyone website grants cannot bypass the Administrator gate', () => {
  const input = fixture({ userId: OWNER });
  assert.doesNotThrow(() => assertGrantChange(input, GUILD, [...PERMISSIONS]));
  input.grants = [{ roleId: GUILD, permissions: [...PERMISSIONS] }];
  input.userId = MEMBER;
  input.memberRoleIds = [];
  assert.equal(resolveAccess(input).allowed, false);
});

test('unknown target roles and invalid permissions are denied even for the owner', () => {
  for (const input of [manager(), manager({ userId: OWNER })]) {
    assert.throws(() => assertGrantChange(input, 'other-guild-role', []), /current server/);
    assert.throws(() => assertGrantChange(input, LOWER, ['unknown' as Permission]), /not recognized/);
  }
});

test('a member lacking Administrator cannot edit grants despite delegated grants', () => {
  const input = manager();
  input.roles[1].permissions = '0';
  assert.throws(() => assertGrantChange(input, LOWER, ['messages.send']), /Administrator/);
});

test('permission decisions and grant checks never mutate their input', () => {
  const input = manager();
  const original = structuredClone(input);
  const result = resolveAccess(input);
  result.permissions.push('settings.manage');
  assertGrantChange(input, LOWER, ['messages.send']);
  assert.deepEqual(input, original);
  assert.equal(resolveAccess(input).permissions.includes('settings.manage'), false);
});
