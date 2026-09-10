import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel,
  HTTPError, PermissionFlagsBits as P, PermissionsBitField, RateLimitError,
  type Client, type GuildScheduledEventCreateOptions, type MessageCreateOptions,
} from 'discord.js';
import type { EventDraft, SavedEventDraft } from '../shared/events.js';
import { BotSendError } from '../server/bot/types.js';
import { createEventTransport } from '../server/events/discord.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';
const BOT = '100000000000000003';
const EVENT = '100000000000000004';
const TEXT = '100000000000000005';
const VOICE = '100000000000000006';
const STAGE = '100000000000000007';
const MESSAGE = '100000000000000008';
const voicePermissions = [P.ViewChannel, P.CreateEvents, P.Connect];
const stagePermissions = [P.ViewChannel, P.CreateEvents, P.ManageChannels, P.MuteMembers, P.MoveMembers];
const textPermissions = [P.ViewChannel, P.SendMessages, P.EmbedLinks];
const draft: EventDraft = {
  name: 'Game night', description: 'A friendly game night', startTime: '2030-10-10T19:00:00.000Z',
  endTime: '2030-10-10T21:00:00.000Z', entityType: 'external', channelId: null,
  location: 'Community hall', announcementChannelId: TEXT, announcementText: 'Join us @everyone', graphic: null,
};
const saved: SavedEventDraft = (({ graphic: _graphic, ...rest }) => ({ ...rest, graphicAlt: 'A colorful game board' }))(draft);

function harness() {
  const requests: unknown[] = [];
  const created: GuildScheduledEventCreateOptions[] = [];
  const sent: MessageCreateOptions[] = [];
  const roles = new Map([['current-role', {}]]);
  const roleCache = new Map([...roles, ['deleted-role', {}]]);
  const member = { id: BOT, guild: { id: GUILD }, permissions: new PermissionsBitField(P.CreateEvents) };
  const makeChannel = (id: string, type: ChannelType, permissions: bigint[]) => ({
    id, guildId: GUILD, name: id === TEXT ? 'announcements' : id === VOICE ? 'voice room' : 'stage room', type,
    permissions: new PermissionsBitField(permissions),
    permissionsFor(_member: unknown) { return this.permissions; },
    send: async (payload: MessageCreateOptions) => { sent.push(payload); return { id: MESSAGE }; },
  });
  const channels = new Map([
    [TEXT, makeChannel(TEXT, ChannelType.GuildText, textPermissions)],
    [VOICE, makeChannel(VOICE, ChannelType.GuildVoice, voicePermissions)],
    [STAGE, makeChannel(STAGE, ChannelType.GuildStageVoice, stagePermissions)],
  ]);
  const event = {
    id: EVENT, guildId: GUILD, creatorId: BOT, name: 'Current event title', description: 'Current event description',
    scheduledStartTimestamp: Date.parse(draft.startTime), scheduledEndTimestamp: Date.parse(draft.endTime),
    entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: 'Current location' }, channelId: null as string | null,
    coverImageURL: () => `https://cdn.discordapp.com/guild-events/${EVENT}/cover.png`,
  };
  const guild = {
    id: GUILD,
    roles: { cache: roleCache, fetch: async () => { requests.push('roles'); return roles; } },
    members: { fetchMe: async (options: unknown) => { requests.push({ member: options }); return member; } },
    channels: { fetch: async (id?: string, options?: unknown) => {
      requests.push({ channel: id, options }); return id ? channels.get(id) ?? null : channels;
    } },
    scheduledEvents: {
      create: async (options: GuildScheduledEventCreateOptions) => { created.push(options); return { id: EVENT }; },
      fetch: async (options: unknown) => { requests.push({ event: options }); return event; },
    },
  };
  const raw = {
    user: { id: BOT }, isReady: () => true,
    guilds: { fetch: async (options: unknown) => { requests.push({ guild: options }); return guild; } },
  };
  return { raw, guild, member, channels, event, requests, created, sent, roles, roleCache,
    transport: createEventTransport(raw as unknown as Client) };
}

const definitelyUnsent = (error: unknown) => error instanceof BotSendError && !error.uncertain;
const uncertain = (error: unknown) => error instanceof BotSendError && error.uncertain && !error.message.includes('private');

test('event options refresh guild, roles, member, and channels and evict deleted roles', async () => {
  const h = harness();
  assert.deepEqual(await h.transport.options(GUILD), {
    externalAllowed: true,
    eventChannels: [{ id: STAGE, name: 'stage room', type: 'stage' }, { id: VOICE, name: 'voice room', type: 'voice' }],
    announcementChannels: [{ id: TEXT, name: 'announcements' }],
  });
  assert.equal(h.roleCache.has('deleted-role'), false);
  assert.deepEqual(h.requests, [
    { guild: { guild: GUILD, force: true } }, 'roles', { member: { force: true } },
    { channel: undefined, options: undefined },
  ]);
});

test('event discovery applies distinct external, voice, stage, and embed permissions', async () => {
  const h = harness();
  h.member.permissions.remove(P.CreateEvents);
  h.channels.get(VOICE)!.permissions.remove(P.Connect);
  h.channels.get(STAGE)!.permissions.remove(P.MoveMembers);
  h.channels.get(TEXT)!.permissions.remove(P.EmbedLinks);
  assert.deepEqual(await h.transport.options(GUILD), {
    externalAllowed: false, eventChannels: [], announcementChannels: [],
  });
  // Channel-specific Create Events can grant voice events without a guild-wide grant.
  h.channels.get(VOICE)!.permissions.add(P.Connect);
  assert.deepEqual((await h.transport.options(GUILD)).eventChannels.map(channel => channel.id), [VOICE]);
});

test('every required stage permission and voice permission is checked', async () => {
  for (const [id, permissions, entityType] of [[VOICE, voicePermissions, 'voice'], [STAGE, stagePermissions, 'stage']] as const) {
    for (const permission of permissions) {
      const h = harness();
      h.channels.get(id)!.permissions.remove(permission);
      await assert.rejects(h.transport.create(GUILD, { ...draft, entityType, channelId: id, location: null }), definitelyUnsent);
      assert.equal(h.created.length, 0);
    }
  }
});

test('external events require fresh guild permission and creation rechecks after preflight', async () => {
  const h = harness();
  await h.transport.preflight(GUILD, draft);
  h.member.permissions.remove(P.CreateEvents);
  await assert.rejects(h.transport.create(GUILD, draft), definitelyUnsent);
  assert.equal(h.created.length, 0);
  assert.equal(h.requests.filter(value => value === 'roles').length, 2);
});

test('creation requires an eligible announcement target and rejects foreign or mismatched event channels', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.channels.get(TEXT)!.type = ChannelType.PublicThread; },
    (h: ReturnType<typeof harness>) => { h.channels.get(TEXT)!.guildId = OTHER; },
    (h: ReturnType<typeof harness>) => { h.channels.get(VOICE)!.guildId = OTHER; },
    (h: ReturnType<typeof harness>) => { h.channels.get(VOICE)!.type = ChannelType.GuildStageVoice; },
  ]) {
    const h = harness(); change(h);
    await assert.rejects(h.transport.create(GUILD, { ...draft, entityType: 'voice', channelId: VOICE }), definitelyUnsent);
    assert.equal(h.created.length, 0);
  }
});

test('external creation sends GuildOnly event fields and a supplied data URL once', async () => {
  const h = harness();
  const graphic = { data: 'data:image/png;base64,aGVsbG8=', alt: 'Game board' };
  assert.deepEqual(await h.transport.create(GUILD, { ...draft, graphic }), { id: EVENT });
  assert.deepEqual(h.created, [{
    name: draft.name, description: draft.description, scheduledStartTime: draft.startTime,
    scheduledEndTime: draft.endTime, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: draft.location }, image: graphic.data,
  }]);
});

test('voice and stage creation send the selected channel and corresponding type', async () => {
  for (const [channelId, entityType, discordType] of [
    [VOICE, 'voice', GuildScheduledEventEntityType.Voice],
    [STAGE, 'stage', GuildScheduledEventEntityType.StageInstance],
  ] as const) {
    const h = harness();
    await h.transport.create(GUILD, { ...draft, channelId, entityType, location: null });
    assert.equal(h.created[0].channel, channelId);
    assert.equal(h.created[0].entityType, discordType);
    assert.equal('entityMetadata' in h.created[0], false);
  }
});

test('remote image inputs and malformed identifiers cannot reach Discord.js image resolution', async () => {
  const h = harness();
  await assert.rejects(h.transport.create(GUILD, { ...draft, graphic: { data: 'https://example.com/image.png', alt: 'x' } }), definitelyUnsent);
  await assert.rejects(h.transport.create('bad', draft), definitelyUnsent);
  await assert.rejects(h.transport.create(GUILD, { ...draft, announcementChannelId: 'bad' }), definitelyUnsent);
  assert.equal(h.created.length, 0);
});

test('preflight network failures, disconnected bots, and mismatched bot membership are definitely unsent', async () => {
  const h = harness();
  h.raw.isReady = () => false;
  await assert.rejects(h.transport.create(GUILD, draft), definitelyUnsent);
  h.raw.isReady = () => true;
  h.member.id = OTHER;
  await assert.rejects(h.transport.create(GUILD, draft), definitelyUnsent);
  h.member.id = BOT;
  h.guild.id = OTHER;
  await assert.rejects(h.transport.create(GUILD, draft), definitelyUnsent);
  h.guild.id = GUILD;
  h.guild.roles.fetch = async () => { throw new Error('private-network-error'); };
  await assert.rejects(h.transport.create(GUILD, draft), definitelyUnsent);
  assert.equal(h.created.length, 0);
});

test('event POST rejection is definite while network and server errors remain uncertain without retry', async () => {
  for (const [error, check] of [
    [new RateLimitError({ timeToReset: 1000, limit: 1, method: 'POST', hash: 'event', url: 'private-url',
      route: '/guilds/:id/scheduled-events', majorParameter: GUILD, global: false,
      retryAfter: 1000, sublimitTimeout: 0, scope: 'user' }), definitelyUnsent],
    [new HTTPError(403, 'private', 'POST', 'private-url', {}), definitelyUnsent],
    [new HTTPError(429, 'private', 'POST', 'private-url', {}), definitelyUnsent],
    [new HTTPError(503, 'private', 'POST', 'private-url', {}), uncertain],
    [new Error('private-network-error'), uncertain],
  ] as const) {
    const h = harness(); let calls = 0;
    h.guild.scheduledEvents.create = async () => { calls++; throw error; };
    await assert.rejects(h.transport.create(GUILD, draft), check);
    assert.equal(calls, 1);
  }
});

test('announcement uses fresh event details, a Discord link, a trusted cover, and disabled mentions', async () => {
  const h = harness();
  assert.deepEqual(await h.transport.announce(GUILD, EVENT, saved, 'announce-123'), { id: MESSAGE });
  const payload = JSON.parse(JSON.stringify(h.sent[0]));
  assert.equal(payload.content, draft.announcementText);
  assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
  assert.equal(payload.nonce, 'announce-123');
  assert.equal(payload.enforceNonce, true);
  assert.equal(payload.embeds[0].title, h.event.name);
  assert.equal(payload.embeds[0].description, h.event.description);
  assert.equal(payload.embeds[0].url, `https://discord.com/events/${GUILD}/${EVENT}`);
  assert.equal(payload.embeds[0].image.url, h.event.coverImageURL());
  assert.deepEqual(payload.embeds[0].fields, [
    { name: 'Starts', value: `<t:${Date.parse(draft.startTime) / 1000}:F>`, inline: true },
    { name: 'Ends', value: `<t:${Date.parse(draft.endTime) / 1000}:F>`, inline: true },
    { name: 'Location', value: 'Current location' }, { name: 'Graphic description', value: saved.graphicAlt },
  ]);
  assert.ok(h.requests.some(request => JSON.stringify(request) === JSON.stringify({ event: { guildScheduledEvent: EVENT, force: true, cache: false } })));
  assert.ok(h.requests.some(request => JSON.stringify(request) === JSON.stringify({ channel: TEXT, options: { force: true } })));
});

test('announcement refuses foreign events, other creators, changed channels, and missing embed permissions', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.event.guildId = OTHER; },
    (h: ReturnType<typeof harness>) => { h.event.creatorId = OTHER; },
    (h: ReturnType<typeof harness>) => { h.event.id = OTHER; },
    (h: ReturnType<typeof harness>) => { h.channels.get(TEXT)!.guildId = OTHER; },
    (h: ReturnType<typeof harness>) => { h.channels.get(TEXT)!.permissions.remove(P.EmbedLinks); },
  ]) {
    const h = harness(); change(h);
    await assert.rejects(h.transport.announce(GUILD, EVENT, saved, 'request'), definitelyUnsent);
    assert.equal(h.sent.length, 0);
  }
});

test('announcement ignores external and deceptive image URLs and does not require Attach Files', async () => {
  for (const url of ['https://example.com/image.png', 'https://cdn.discordapp.com.evil.example/image.png',
    'https://user:pass@cdn.discordapp.com/image.png', 'http://cdn.discordapp.com/image.png', 'https://cdn.discordapp.com:444/image.png']) {
    const h = harness(); h.event.coverImageURL = () => url;
    await h.transport.announce(GUILD, EVENT, saved, 'request');
    const payload = JSON.parse(JSON.stringify(h.sent[0]));
    assert.equal(payload.embeds[0].image, undefined);
    assert.equal(payload.files, undefined);
  }
});

test('announcement failures before POST are unsent; send failures are uncertain and never retried', async () => {
  const h = harness();
  await assert.rejects(h.transport.announce(GUILD, EVENT, saved, 'invalid nonce'), definitelyUnsent);
  await assert.rejects(h.transport.announce(GUILD, EVENT, { ...saved, announcementText: 'x'.repeat(2001) }, 'request'), definitelyUnsent);
  h.guild.scheduledEvents.fetch = async () => { throw new Error('private-event-fetch'); };
  await assert.rejects(h.transport.announce(GUILD, EVENT, saved, 'request'), definitelyUnsent);
  assert.equal(h.sent.length, 0);
  h.guild.scheduledEvents.fetch = async () => h.event;
  let calls = 0;
  h.channels.get(TEXT)!.send = async () => { calls++; throw new Error('private-send'); };
  await assert.rejects(h.transport.announce(GUILD, EVENT, saved, 'request'), uncertain);
  assert.equal(calls, 1);
});
