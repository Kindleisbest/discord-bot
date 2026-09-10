import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  ApplicationIntegrationType, ButtonStyle, Collection, DiscordAPIError,
  HTTPError, InteractionContextType, MessageFlags,
  type ChatInputCommandInteraction, type Client, type InteractionEditReplyOptions,
} from 'discord.js';
import { readConfig } from '../server/config.js';
import type { GuildAccessInput } from '../server/permissions.js';
import {
  COMMANDS, EPHEMERAL_LIFETIME_MS, canUseCommand, commandAccess,
  commandDefinitions, createCommandHandler, helpText, scheduleEphemeralDeletion, visibleCommands,
} from '../server/bot/commands.js';
import { classifySendError, createBot, validateSendInput } from '../server/bot/gateway.js';
import { BotSendError, BotUnavailableError } from '../server/bot/types.js';

const GUILD = '100000000000000001';
const CHANNEL = '100000000000000002';
const OWNER = '100000000000000003';
const USER = '100000000000000004';
const ROLE = '100000000000000005';

function membership(overrides: Partial<GuildAccessInput> = {}): GuildAccessInput {
  return {
    guildId: GUILD, ownerId: OWNER, userId: USER, memberRoleIds: [ROLE], grants: [],
    roles: [
      { id: GUILD, name: '@everyone', position: 0, permissions: '0' },
      { id: ROLE, name: 'Administrator', position: 1, permissions: '0' },
    ], ...overrides,
  };
}

function mockCommand(t: TestContext, commandName: string, input = membership()) {
  const events: string[] = [];
  const edits: InteractionEditReplyOptions[] = [];
  const acknowledgements: unknown[] = [];
  const fetches: unknown[] = [];
  const roles = new Collection(input.roles.map(role => [role.id, {
    ...role, rawPosition: role.position, permissions: { bitfield: BigInt(role.permissions) },
  }]));
  const guild = {
    id: input.guildId, ownerId: input.ownerId,
    roles: { fetch: async () => { events.push('roles.fetch'); return roles; } },
    members: { fetch: async (options: unknown) => {
      events.push('member.fetch'); fetches.push(options);
      return { roles: { cache: new Map(input.memberRoleIds.map(id => [id, {}])) } };
    } },
  };
  const fakeClient = { guilds: { fetch: async (options: unknown) => {
    events.push('guild.fetch'); fetches.push(options); return guild;
  } } };
  const rawInteraction = {
    commandName, guildId: input.guildId as string | null, channelId: CHANNEL,
    user: { id: input.userId }, deferred: false, replied: false,
    deferReply: async (options: unknown) => {
      events.push('defer'); acknowledgements.push(options); rawInteraction.deferred = true;
    },
    editReply: async (options: InteractionEditReplyOptions) => { events.push('edit'); edits.push(options); },
    reply: async (options: unknown) => { acknowledgements.push(options); rawInteraction.replied = true; },
    deleteReply: async () => { events.push('delete'); },
  };
  const activity: string[] = [];
  const client = fakeClient as unknown as Client;
  const interaction = rawInteraction as unknown as ChatInputCommandInteraction;
  const handler = createCommandHandler(client, readConfig({}), (_guild, _actor, action) => { activity.push(action); });
  t.after(() => handler.stop());
  return { handler, client, interaction, rawInteraction, fakeClient, events, edits, acknowledgements, fetches, activity };
}

test('members only see help and ping; role names do not grant dashboard access', () => {
  const access = commandAccess(membership());
  assert.deepEqual(visibleCommands(access).map(item => item.name), ['help', 'ping', 'contact']);
  assert.equal(canUseCommand('dashboard', access), false);
  assert.equal(helpText(access).includes('/dashboard'), false);
  assert.equal(helpText(access).includes('/contact'), true);
});

test('current Administrator permission exposes dashboard regardless of role name', () => {
  const input = membership();
  input.roles[1].permissions = '8';
  input.roles[1].name = 'Staff';
  const access = commandAccess(input);
  assert.deepEqual(visibleCommands(access).map(item => item.name), ['help', 'dashboard', 'ping', 'contact']);
  assert.equal(canUseCommand('dashboard', access), true);
});

test('the server owner can use dashboard without holding roles', () => {
  const access = commandAccess(membership({ userId: OWNER, memberRoleIds: [], roles: [] }));
  assert.equal(canUseCommand('dashboard', access), true);
  assert.equal(helpText(access).includes('/dashboard'), true);
});

test('website grants cannot expose dashboard after Administrator is removed', () => {
  const input = membership({ grants: [{ roleId: ROLE, permissions: ['permissions.manage', 'settings.manage'] }] });
  assert.equal(canUseCommand('dashboard', commandAccess(input)), false);
});

test('all command visibility uses the same handler authorization policy', () => {
  for (const access of [
    { inGuild: false, administrator: false }, { inGuild: false, administrator: true },
    { inGuild: true, administrator: false }, { inGuild: true, administrator: true },
  ]) {
    const names = visibleCommands(access).map(command => command.name);
    for (const command of COMMANDS) {
      assert.equal(names.includes(command.name), canUseCommand(command.name, access));
    }
    assert.equal(canUseCommand('unknown', access), false);
  }
  assert.deepEqual(visibleCommands(commandAccess(null)), []);
});

test('registered commands are guild-only and dashboard defaults to Administrator', () => {
  const definitions = commandDefinitions();
  assert.deepEqual(definitions.map(command => command.name), ['help', 'dashboard', 'ping', 'contact']);
  for (const command of definitions) {
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(command.integration_types, [ApplicationIntegrationType.GuildInstall]);
    assert.equal(command.default_member_permissions, command.name === 'dashboard' ? '8' : undefined);
  }
});

test('help acknowledges privately before freshly fetching roles and membership', async t => {
  const mock = mockCommand(t, 'help');
  await mock.handler.handle(mock.interaction);
  assert.equal(mock.events[0], 'defer');
  assert.deepEqual(mock.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(mock.fetches, [{ guild: GUILD, force: true }, { user: USER, force: true, cache: false }]);
  assert.equal(mock.edits[0].content?.includes('/dashboard'), false);
  assert.equal(mock.edits[0].content?.includes('/help'), true);
  assert.deepEqual(mock.activity, ['command.help']);
});

test('dashboard denies stale interaction privileges after the current role loses Administrator', async t => {
  const mock = mockCommand(t, 'dashboard');
  Object.assign(mock.rawInteraction, { memberPermissions: { has: () => true } });
  await mock.handler.handle(mock.interaction);
  assert.match(mock.edits[0].content as string, /requires.*Administrator/);
  assert.equal(mock.edits[0].components, undefined);
  assert.deepEqual(mock.activity, ['command.denied']);
});

test('dashboard sends an authorized owner a website link button', async t => {
  const mock = mockCommand(t, 'dashboard', membership({ userId: OWNER, memberRoleIds: [] }));
  await mock.handler.handle(mock.interaction);
  const component = JSON.parse(JSON.stringify(mock.edits[0].components))[0].components[0];
  assert.equal(component.style, ButtonStyle.Link);
  assert.equal(component.url, 'http://127.0.0.1:3000/');
  assert.deepEqual(mock.activity, ['command.dashboard']);
});

test('failed access lookup hides dashboard and never reflects raw errors', async t => {
  const mock = mockCommand(t, 'dashboard');
  mock.fakeClient.guilds.fetch = async () => { throw new Error('secret-oauth-token-should-not-leak'); };
  await mock.handler.handle(mock.interaction);
  assert.match(mock.edits[0].content as string, /could not complete/);
  assert.equal(JSON.stringify(mock.edits).includes('secret-oauth'), false);
  assert.deepEqual(mock.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
});

test('help still shows public commands if Discord cannot verify privileges', async t => {
  const mock = mockCommand(t, 'help');
  mock.fakeClient.guilds.fetch = async () => { throw new Error('offline'); };
  await mock.handler.handle(mock.interaction);
  assert.equal(mock.edits[0].content?.includes('/help'), true);
  assert.equal(mock.edits[0].content?.includes('/ping'), true);
  assert.equal(mock.edits[0].content?.includes('/dashboard'), false);
});

test('ping responds privately without unnecessary member fetches', async t => {
  const mock = mockCommand(t, 'ping');
  await mock.handler.handle(mock.interaction);
  assert.equal(mock.edits[0].content, 'Pong! The bot is responding.');
  assert.deepEqual(mock.fetches, []);
  assert.deepEqual(mock.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
});

test('unexpected direct-message commands are rejected privately', async t => {
  const mock = mockCommand(t, 'ping');
  mock.rawInteraction.guildId = null;
  await mock.handler.handle(mock.interaction);
  assert.equal(mock.edits[0].content, 'Use this command inside a server.');
  assert.deepEqual(mock.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
});

test('activity callback failures do not prevent successful command replies', async t => {
  const mock = mockCommand(t, 'ping');
  const handler = createCommandHandler(mock.client, readConfig({}), () => { throw new Error('storage-secret'); });
  t.after(() => handler.stop());
  await handler.handle(mock.interaction);
  assert.equal(mock.edits.length, 1);
  assert.equal(mock.edits[0].content, 'Pong! The bot is responding.');
});

test('ephemeral deletion defaults to two minutes and does not keep the process alive', async () => {
  assert.equal(EPHEMERAL_LIFETIME_MS, 120_000);
  let deleted = 0;
  const timer = scheduleEphemeralDeletion(async () => { deleted++; }, 1);
  assert.equal(timer.hasRef(), false);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(deleted, 1);
});

test('expired interaction errors during deletion are safely consumed', async () => {
  scheduleEphemeralDeletion(async () => { throw new Error('expired-private-interaction-token'); }, 1);
  await new Promise(resolve => setTimeout(resolve, 15));
});

test('message input rejects invalid IDs, empty or long content, and oversized nonce', () => {
  const valid = { guildId: GUILD, channelId: CHANNEL, content: 'Hello', nonce: 'request_123' };
  assert.doesNotThrow(() => validateSendInput(valid));
  for (const input of [
    { ...valid, guildId: 'invalid' }, { ...valid, channelId: 'invalid' },
    { ...valid, content: '' }, { ...valid, content: '   ' }, { ...valid, content: 'x'.repeat(2001) },
    { ...valid, nonce: '' }, { ...valid, nonce: 'x'.repeat(26) },
  ]) {
    assert.throws(() => validateSendInput(input), error => error instanceof BotSendError && !error.uncertain);
  }
  assert.doesNotThrow(() => validateSendInput({ ...valid, content: 'x'.repeat(2000), nonce: 'x'.repeat(25) }));
});

test('send failures distinguish definite Discord rejection from uncertain delivery', () => {
  const discordRejection = new DiscordAPIError({ message: 'private request body', code: 50013 }, 50013,
    403, 'POST', 'https://discord.com/api/channels/secret/messages', { body: { content: 'private text' } });
  assert.equal(classifySendError(discordRejection).uncertain, false);
  assert.equal(classifySendError(new HTTPError(400, 'Bad Request', 'POST', 'private-url', {})).uncertain, false);
  assert.equal(classifySendError(new HTTPError(500, 'Server Error', 'POST', 'private-url', {})).uncertain, true);
  const uncertain = classifySendError(new Error('private-transport-details'));
  assert.equal(uncertain.uncertain, true);
  assert.equal(uncertain.message.includes('private'), false);
  assert.equal(classifySendError(discordRejection).message.includes('private'), false);
});

test('an unconfigured bot never connects and cannot send or list channels', async () => {
  const bot = createBot(readConfig({}), { addActivity() {}, removeGuild() {} });
  await bot.start();
  assert.deepEqual(bot.status(), { state: 'not_configured', lastReadyAt: null });
  await assert.rejects(bot.listSendableChannels(GUILD), BotUnavailableError);
  await assert.rejects(bot.sendMessage({ guildId: GUILD, channelId: CHANNEL, content: 'Hello', nonce: 'request' }), BotUnavailableError);
  await bot.stop();
  await bot.stop();
});
