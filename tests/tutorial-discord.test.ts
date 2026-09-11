import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType, PermissionFlagsBits as P, PermissionsBitField, type Client } from 'discord.js';
import { TutorialError } from '../shared/tutorial.js';
import { createTutorialTransport } from '../server/tutorial/discord.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';
const BOT = '100000000000000003';
const USER = '100000000000000004';
const TEXT = '100000000000000005';
const ROLE = '100000000000000006';

function harness() {
  const requests: unknown[] = [];
  const roles = new Map([[GUILD, {}]]);
  const roleCache = new Map([...roles, [ROLE, {}]]);
  const bot = { id: BOT, guild: { id: GUILD } };
  const member = { id: USER, guild: { id: GUILD } };
  function channel(id = TEXT, type = ChannelType.GuildText, rawPosition = 0) {
    return {
      id, guildId: GUILD, name: `channel-${rawPosition}`, type, rawPosition,
      botPermissions: new PermissionsBitField(P.ViewChannel),
      memberPermissions: new PermissionsBitField(P.ViewChannel),
      permissionsFor(who: { id: string }): PermissionsBitField | null {
        assert.ok(who === bot || who === member, 'permissions use freshly fetched member objects');
        return who === bot ? this.botPermissions : this.memberPermissions;
      },
      // The tutorial transport must never touch message content.
      get messages(): never { throw new Error('Messages must not be accessed'); },
      send(): never { throw new Error('Messages must not be sent'); },
    };
  }
  const channels = new Map<string, ReturnType<typeof channel> | null>([[TEXT, channel()]]);
  const guild = {
    id: GUILD,
    roles: { cache: roleCache, fetch: async () => { requests.push('roles'); return roles; } },
    members: {
      fetchMe: async (options: unknown) => { requests.push({ bot: options }); return bot; },
      fetch: async (options: unknown) => { requests.push({ member: options }); return member; },
    },
    channels: { fetch: async (...args: unknown[]) => { requests.push({ channels: args }); return channels; } },
  };
  const raw = {
    isReady: () => true, user: { id: BOT },
    guilds: { fetch: async (options: unknown) => { requests.push({ guild: options }); return guild; } },
  };
  return { raw, guild, bot, member, channel, channels, roles, roleCache, requests,
    transport: createTutorialTransport(raw as unknown as Client) };
}

const failed = (statusCode: number) => (error: unknown) => error instanceof TutorialError
  && error.statusCode === statusCode && !error.message.includes('private');

test('channel order uses position then numeric channel ID independently of collection order', async () => {
  const h = harness();
  h.channels.clear();
  const later = (BigInt(TEXT) + 1n).toString();
  h.channels.set(OTHER, h.channel(OTHER, ChannelType.GuildText, 2));
  h.channels.set(later, h.channel(later, ChannelType.GuildText, 1));
  h.channels.set(TEXT, h.channel(TEXT, ChannelType.GuildText, 1));
  assert.deepEqual((await h.transport.channels(GUILD, USER)).map(channel => channel.id), [TEXT, later, OTHER]);
});

test('tutorial channel discovery freshly fetches guild, full roles, bot, member, and channels', async () => {
  const h = harness();
  assert.deepEqual(await h.transport.channels(GUILD, USER), [
    { id: TEXT, name: 'channel-0', type: ChannelType.GuildText, position: 0 },
  ]);
  assert.deepEqual(h.requests, [
    { guild: { guild: GUILD, force: true } }, 'roles', { bot: { force: true } },
    { member: { user: USER, force: true, cache: false } }, { channels: [] },
  ]);
  assert.equal(h.roleCache.has(ROLE), false);
});

test('administrative discovery uses bot visibility and does not fetch a member', async () => {
  const h = harness();
  h.channels.get(TEXT)!.memberPermissions.remove(P.ViewChannel);
  assert.equal((await h.transport.channels(GUILD)).length, 1);
  assert.equal(h.requests.some(value => typeof value === 'object' && value !== null && 'member' in value), false);
  assert.deepEqual(await h.transport.channels(GUILD, USER), []);
});

test('only supported top-level guild channel types are exposed, including category children', async () => {
  const h = harness();
  h.channels.clear();
  const supported = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
    ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia];
  const unsupported = [ChannelType.GuildCategory, ChannelType.PublicThread, ChannelType.PrivateThread,
    ChannelType.AnnouncementThread, ChannelType.DM, ChannelType.GroupDM];
  for (const [i, type] of [...supported, ...unsupported].entries()) {
    const id = String(BigInt(TEXT) + BigInt(i));
    h.channels.set(id, Object.assign(h.channel(id, type, i), { parentId: OTHER }));
  }
  h.channels.set('null', null);
  h.channels.set('foreign', Object.assign(h.channel(OTHER), { guildId: OTHER }));
  h.channels.set('bad-id', h.channel('bad-id'));
  const visible = await h.transport.channels(GUILD, USER);
  assert.deepEqual(visible.map(channel => channel.type), supported);
  assert.deepEqual(visible.map(channel => channel.position), supported.map((_, i) => i));
});

test('both bot and member must have ViewChannel; unrelated permissions are not required', async () => {
  const h = harness();
  const target = h.channels.get(TEXT)!;
  assert.equal((await h.transport.channels(GUILD, USER)).length, 1);
  target.botPermissions.remove(P.ViewChannel);
  assert.deepEqual(await h.transport.channels(GUILD, USER), []);
  assert.deepEqual(await h.transport.channels(GUILD), []);
  target.botPermissions.add(P.ViewChannel);
  target.memberPermissions.remove(P.ViewChannel);
  assert.deepEqual(await h.transport.channels(GUILD, USER), []);
  target.permissionsFor = () => null;
  assert.deepEqual(await h.transport.channels(GUILD), []);
});

test('subsequent discovery respects fresh channel metadata and permission revocation without cached results', async () => {
  const h = harness();
  assert.equal((await h.transport.channels(GUILD, USER)).length, 1);
  const replacement = h.channel(TEXT, ChannelType.GuildAnnouncement, 7);
  replacement.name = 'renamed';
  h.channels.set(TEXT, replacement);
  assert.deepEqual(await h.transport.channels(GUILD, USER), [
    { id: TEXT, name: 'renamed', type: ChannelType.GuildAnnouncement, position: 7 },
  ]);
  replacement.memberPermissions.remove(P.ViewChannel);
  assert.deepEqual(await h.transport.channels(GUILD, USER), []);
  h.channels.delete(TEXT);
  assert.deepEqual(await h.transport.channels(GUILD, USER), []);
  assert.equal(h.requests.filter(value => value === 'roles').length, 4);
});

test('deleted cached roles cannot grant bot or member visibility after fresh role discovery', async () => {
  for (const identity of ['bot', 'member'] as const) {
    const h = harness();
    h.channels.get(TEXT)!.permissionsFor = who => new PermissionsBitField(
      who === h[identity] && !h.roleCache.has(ROLE) ? 0n : P.ViewChannel,
    );
    assert.equal(h.roleCache.has(ROLE), true);
    assert.deepEqual(await h.transport.channels(GUILD, USER), []);
    assert.equal(h.roleCache.has(ROLE), false);
  }
});

test('invalid server and member identifiers fail before contacting Discord', async () => {
  const h = harness();
  for (const [guildId, userId] of [['bad', USER], [GUILD, 'bad'], [GUILD, ''], ['', USER],
    ['1'.repeat(21), USER], [123 as unknown as string, USER]]) {
    await assert.rejects(h.transport.channels(guildId, userId), failed(400));
  }
  assert.deepEqual(h.requests, []);
});

test('mismatched guild, bot, or member identity fails closed', async () => {
  const changes: ((h: ReturnType<typeof harness>) => void)[] = [
    h => { h.guild.id = OTHER; }, h => { h.bot.id = OTHER; }, h => { h.bot.guild.id = OTHER; },
    h => { h.member.id = OTHER; }, h => { h.member.guild.id = OTHER; },
  ];
  for (const change of changes) {
    const h = harness(); change(h);
    await assert.rejects(h.transport.channels(GUILD, USER), failed(503));
  }
});

test('lookup failures and readiness changes reveal no Discord error details', async () => {
  const reject = async (): Promise<never> => { throw new Error('private channel, user, token, URL'); };
  const changes: ((h: ReturnType<typeof harness>) => void)[] = [
    h => { h.raw.isReady = () => false; }, h => { h.raw.guilds.fetch = reject; },
    h => { h.guild.roles.fetch = reject; }, h => { h.guild.members.fetchMe = reject; },
    h => { h.guild.members.fetch = reject; }, h => { h.guild.channels.fetch = reject; },
    h => { h.channels.get(TEXT)!.permissionsFor = () => { throw new Error('private channel'); }; },
    h => { h.guild.channels.fetch = async () => { h.raw.isReady = () => false; return h.channels; }; },
    h => { h.guild.channels.fetch = async () => { h.raw.user.id = OTHER; return h.channels; }; },
  ];
  for (const change of changes) {
    const h = harness(); change(h);
    await assert.rejects(h.transport.channels(GUILD, USER), failed(503));
  }
  assert.equal((await harness().transport.channels(GUILD, USER)).length, 1, 'failed lookups release their slots');
});

test('at most three lookups run globally across transport instances and overflow never contacts Discord', async () => {
  const active = [harness(), harness(), harness()];
  const releases: (() => void)[] = [];
  for (const h of active) {
    const fetch = h.raw.guilds.fetch;
    h.raw.guilds.fetch = async options => {
      await new Promise<void>(resolve => releases.push(resolve));
      return fetch(options);
    };
  }
  const pending = active.map(h => h.transport.channels(GUILD, USER));
  try {
    assert.equal(releases.length, 3);
    const overflow = harness();
    await assert.rejects(overflow.transport.channels(GUILD, USER), failed(429));
    assert.deepEqual(overflow.requests, []);
    releases[0]();
    await pending[0];
    assert.equal((await overflow.transport.channels(GUILD, USER)).length, 1);
  } finally {
    for (const release of releases) release();
    await Promise.allSettled(pending);
  }
  assert.equal((await harness().transport.channels(GUILD)).length, 1);
});
