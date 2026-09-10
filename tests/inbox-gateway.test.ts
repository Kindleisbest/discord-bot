import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { type TestContext } from 'node:test';
import {
  ChannelType, Events, HTTPError, MessageFlags, type Client, type MessageCreateOptions,
} from 'discord.js';
import { InboxError } from '../shared/inbox.js';
import { attachmentMetadata, attachInboxGateway, createInboxTransport } from '../server/inbox/gateway.js';
import type { InboxGatewayService } from '../server/inbox/types.js';
import { BotSendError, BotUnavailableError } from '../server/bot/types.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';
const USER = '100000000000000003';
const BOT = '100000000000000004';
const MESSAGE = '100000000000000005';
const FILE = '100000000000000006';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fakeClient() {
  const requests: unknown[] = [];
  const sent: MessageCreateOptions[] = [];
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    user: { id: BOT }, isReady: (): boolean => true,
    guilds: { fetch: async (options: { guild: string; force: boolean }) => {
      requests.push(options);
      return { id: options.guild, name: 'Example server', members: { fetch: async (member: { user: string; force: boolean; cache: boolean }) => {
        requests.push(member); return { id: member.user };
      } } };
    } },
    users: { createDM: async (userId: string, options: unknown) => {
      requests.push({ userId, options });
      return { send: async (options: MessageCreateOptions) => { sent.push(options); return { id: MESSAGE }; } };
    } },
  });
  return { raw: client, client: client as unknown as Client, requests, sent };
}

function harness(t: TestContext, overrides: Partial<InboxGatewayService> = {}) {
  const mock = fakeClient();
  const calls: { name: string; args: unknown[] }[] = [];
  const service: InboxGatewayService = {
    contact: async (...args) => { calls.push({ name: 'contact', args }); return { id: GUILD, name: 'Example server' }; },
    choices: async (...args) => { calls.push({ name: 'choices', args }); return { token: 'choice-token', guilds: [{ id: GUILD, name: 'Example server' }] }; },
    choose: async (...args) => { calls.push({ name: 'choose', args }); return { id: GUILD, name: 'Example server' }; },
    receive: async (...args) => { calls.push({ name: 'receive', args }); return { routed: false }; },
    ...overrides,
  };
  const gateway = attachInboxGateway(mock.client, service);
  t.after(() => gateway.stop());
  const dmSent: MessageCreateOptions[] = [];
  const message = {
    id: MESSAGE, guildId: null as string | null, author: { id: USER, bot: false },
    content: 'Private member question', createdTimestamp: 1_800_000_000_000,
    attachments: new Map(),
    channel: { type: ChannelType.DM as ChannelType, send: async (payload: MessageCreateOptions) => { dmSent.push(payload); } },
  };
  function interaction(kind: 'contact' | 'button' | 'select', customId = 'inbox:contact', guildId: string | null = GUILD) {
    const edits: MessageCreateOptions[] = [];
    const acknowledgements: unknown[] = [];
    const raw = {
      commandName: kind === 'contact' ? 'contact' : '', customId, guildId, user: { id: USER },
      values: [GUILD], deferred: false, replied: false,
      isChatInputCommand: () => kind === 'contact', isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select',
      deferReply: async (options: unknown) => { acknowledgements.push(options); raw.deferred = true; },
      deferUpdate: async () => { acknowledgements.push('update'); raw.deferred = true; },
      editReply: async (payload: MessageCreateOptions) => { edits.push(payload); },
      reply: async (payload: MessageCreateOptions) => { edits.push(payload); raw.replied = true; },
      deleteReply: async () => undefined,
    };
    return { raw, edits, acknowledgements };
  }
  return { ...mock, gateway, service, calls, message, dmSent, interaction };
}

test('transport membership verification always fetches the current guild and member', async () => {
  const mock = fakeClient();
  const transport = createInboxTransport(mock.client);
  assert.deepEqual(await transport.verifyMember(GUILD, USER), { id: GUILD, name: 'Example server' });
  assert.deepEqual(mock.requests, [{ guild: GUILD, force: true }, { user: USER, force: true, cache: false }]);
  mock.raw.isReady = () => false;
  await assert.rejects(transport.verifyMember(GUILD, USER), BotUnavailableError);
});

test('eligible server discovery only checks supplied IDs, deduplicates, and bounds concurrency to three', async () => {
  const mock = fakeClient();
  let active = 0;
  let maximum = 0;
  const seen: string[] = [];
  mock.raw.guilds.fetch = async options => {
    active++; maximum = Math.max(maximum, active); seen.push(options.guild);
    await flush(); active--;
    return { id: options.guild, name: options.guild, members: { fetch: async member => ({ id: member.user }) } };
  };
  const ids = Array.from({ length: 30 }, (_, index) => (100000000000000010n + BigInt(index)).toString());
  const result = await createInboxTransport(mock.client).eligibleGuilds(USER, [ids[0], ...ids]);
  assert.equal(result.length, 25);
  assert.equal(maximum, 3);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.every(id => ids.includes(id)), true);
});

test('eligible servers skip 403/404 membership failures but fail closed on a transport failure', async () => {
  const mock = fakeClient();
  const original = mock.raw.guilds.fetch;
  mock.raw.guilds.fetch = async options => {
    if (options.guild === GUILD) throw new HTTPError(404, 'Secret error detail', 'GET', 'private-url', {});
    return original(options);
  };
  const transport = createInboxTransport(mock.client);
  assert.deepEqual(await transport.eligibleGuilds(USER, [GUILD, OTHER]), [{ id: OTHER, name: 'Example server' }]);
  mock.raw.guilds.fetch = async () => { throw new Error('private-network-details'); };
  await assert.rejects(transport.eligibleGuilds(USER, [GUILD]), error =>
    error instanceof InboxError && error.statusCode === 503 && !error.message.includes('private'));
});

test('staff replies verify membership and send a server-labeled embed with mentions suppressed', async () => {
  const mock = fakeClient();
  const result = await createInboxTransport(mock.client).sendReply({ guildId: GUILD, memberId: USER, content: 'Hello @everyone', nonce: 'reply-123' });
  assert.deepEqual(result, { id: MESSAGE });
  assert.deepEqual(mock.requests.slice(0, 2), [{ guild: GUILD, force: true }, { user: USER, force: true, cache: false }]);
  const payload = JSON.parse(JSON.stringify(mock.sent[0]));
  assert.equal(payload.embeds[0].title, 'Example server staff');
  assert.equal(payload.embeds[0].description, 'Hello @everyone');
  assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
  assert.equal(payload.nonce, 'reply-123');
  assert.equal(payload.enforceNonce, true);
});

test('reply preflight failures are definitely unsent and transport send failures remain uncertain', async () => {
  const mock = fakeClient();
  const transport = createInboxTransport(mock.client);
  await assert.rejects(transport.sendReply({ guildId: GUILD, memberId: USER, content: 'x'.repeat(2001), nonce: 'request' }),
    error => error instanceof BotSendError && !error.uncertain);
  assert.equal(mock.requests.length, 0);
  mock.raw.users.createDM = async () => { throw new Error('private-dm-failure'); };
  await assert.rejects(transport.sendReply({ guildId: GUILD, memberId: USER, content: 'Hello', nonce: 'request' }),
    error => error instanceof BotSendError && !error.uncertain);
  mock.raw.users.createDM = async () => ({ send: async () => { throw new Error('private-send-failure'); } });
  await assert.rejects(transport.sendReply({ guildId: GUILD, memberId: USER, content: 'Hello', nonce: 'request' }),
    error => error instanceof BotSendError && error.uncertain && !error.message.includes('private'));
});

test('attachment metadata rejects external, insecure, deceptive, and invalid URLs', () => {
  const attachment = { id: FILE, name: 'report\u0000.pdf', url: 'https://cdn.discordapp.com/attachments/file?ex=123&hm=abc', size: 42 };
  const metadata = attachmentMetadata([
    attachment,
    ...['http://cdn.discordapp.com/file', 'https://cdn.discordapp.com.evil.example/file',
      'https://user:pass@cdn.discordapp.com/file', 'https://cdn.discordapp.com:444/file', 'https://example.com/file', 'not a URL']
      .map(url => ({ ...attachment, url })),
    { ...attachment, size: -1 },
  ]);
  assert.deepEqual(metadata, [{ ...attachment, name: 'report.pdf' }]);
  assert.equal(attachmentMetadata(Array.from({ length: 15 }, () => ({ ...attachment, name: 'x'.repeat(300) }))).length, 10);
  assert.equal(attachmentMetadata([{ ...attachment, name: 'x'.repeat(300) }])[0].name.length, 256);
});

test('guild messages and bot-authored direct messages never enter the inbox', async t => {
  const h = harness(t);
  h.raw.emit(Events.MessageCreate, { ...h.message, guildId: GUILD });
  h.raw.emit(Events.MessageCreate, { ...h.message, author: { id: BOT, bot: true } });
  await flush();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.dmSent, []);
});

test('an unrouted first message requires an explicit server choice even with one eligible server', async t => {
  const h = harness(t);
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  assert.deepEqual(h.calls.map(call => call.name), ['receive', 'choices']);
  const payload = JSON.parse(JSON.stringify(h.dmSent[0]));
  assert.match(payload.content, /first message has not been saved or forwarded/);
  assert.match(payload.content, /90 days/);
  assert.equal(payload.components[0].components[0].custom_id, 'inbox:choose:choice-token');
  assert.deepEqual(payload.components[0].components[0].options.map((item: { value: string }) => item.value), [GUILD]);
  assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
  assert.equal(payload.flags, MessageFlags.SuppressEmbeds);
});

test('server selection delegates the token, acting user, and selected server without resending old content', async t => {
  const h = harness(t);
  const selection = h.interaction('select', 'inbox:choose:choice-token', null);
  selection.raw.user.id = OTHER;
  h.raw.emit(Events.InteractionCreate, selection.raw);
  await flush();
  assert.deepEqual(h.calls, [{ name: 'choose', args: ['choice-token', OTHER, GUILD] }]);
  assert.deepEqual(selection.acknowledgements, ['update']);
  assert.match(selection.edits[0].content as string, /Resend your message/);
});

test('expired or other-user choices show the service’s safe denial and do not route content', async t => {
  const h = harness(t, { choose: async () => { throw new InboxError(403, 'This choice expired or belongs to another account. Choose again.'); } });
  const selection = h.interaction('select', 'inbox:choose:choice-token', null);
  h.raw.emit(Events.InteractionCreate, selection.raw);
  await flush();
  assert.match(selection.edits[0].content as string, /belongs to another account/);
  assert.deepEqual(selection.edits[0].components, []);
  assert.equal(h.calls.some(call => call.name === 'receive'), false);
});

test('new routed messages acknowledge the chosen server with a switch button', async t => {
  const h = harness(t, { receive: async () => ({ routed: true, created: true, guildName: 'Example **server**', ticketId: 'ticket' }) });
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  const payload = JSON.parse(JSON.stringify(h.dmSent[0]));
  assert.match(payload.content, /sent to staff at/);
  assert.equal(payload.content.includes('Example \\*\\*server\\*\\*'), true);
  assert.equal(payload.components[0].components[0].custom_id, 'inbox:switch');
});

test('duplicate received messages do not create duplicate acknowledgements', async t => {
  const h = harness(t, { receive: async () => ({ routed: true, created: false, guildName: 'Example server', ticketId: 'ticket' }) });
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  assert.deepEqual(h.dmSent, []);
});

test('switch server requests a new chooser and never silently selects a route', async t => {
  const h = harness(t);
  const selection = h.interaction('button', 'inbox:switch', null);
  h.raw.emit(Events.InteractionCreate, selection.raw);
  await flush();
  assert.deepEqual(h.calls, [{ name: 'choices', args: [USER] }]);
  assert.match(selection.edits[0].content as string, /Choose the server/);
});

test('contact and the help button acknowledge privately and use the current server', async t => {
  const h = harness(t);
  for (const kind of ['contact', 'button'] as const) {
    const contact = h.interaction(kind);
    h.raw.emit(Events.InteractionCreate, contact.raw);
    await flush();
    assert.deepEqual(contact.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
    const payload = JSON.parse(JSON.stringify(contact.edits[0]));
    assert.match(payload.content, /Your messages will go to staff/);
    assert.match(payload.content, /90 days/);
    assert.equal(payload.components[0].components[0].url, `https://discord.com/users/${BOT}`);
  }
  assert.deepEqual(h.calls, Array.from({ length: 2 }, () => ({ name: 'contact', args: [GUILD, USER] })));
});

test('disabled inboxes show only the safe service message', async t => {
  const h = harness(t, { contact: async () => { throw new InboxError(403, 'Staff messages are not enabled for this server.'); } });
  const contact = h.interaction('contact');
  h.raw.emit(Events.InteractionCreate, contact.raw);
  await flush();
  assert.equal(contact.edits[0].content, 'Staff messages are not enabled for this server.');
});

test('no eligible servers produces a clear response without an empty menu', async t => {
  const h = harness(t, { choices: async () => ({ token: 'token', guilds: [] }) });
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  assert.match(h.dmSent[0].content as string, /no servers available/);
  assert.deepEqual(h.dmSent[0].components, []);
});

test('unexpected service errors are not reflected in direct messages', async t => {
  const h = harness(t, { receive: async () => { throw new Error('private-token-or-message-body'); } });
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  assert.match(h.dmSent[0].content as string, /temporarily unavailable/);
  assert.equal(JSON.stringify(h.dmSent).includes('private-token'), false);
});

test('oversized messages are rejected without truncating or storing them', async t => {
  const h = harness(t);
  h.raw.emit(Events.MessageCreate, { ...h.message, content: 'x'.repeat(4001) });
  await flush();
  assert.deepEqual(h.calls, []);
  assert.match(h.dmSent[0].content as string, /4,000/);
});

test('per-user throttling allows ten messages, warns once, and does not enqueue more', async t => {
  let received = 0;
  const h = harness(t, { receive: async () => { received++; return { routed: true, created: false, guildName: 'Server', ticketId: 'ticket' }; } });
  for (let index = 0; index < 15; index++) { h.raw.emit(Events.MessageCreate, h.message); await flush(); }
  assert.equal(received, 10);
  assert.equal(h.dmSent.length, 1);
  assert.match(h.dmSent[0].content as string, /wait one minute/);
});

test('concurrent messages from one user are not queued and stop detaches both listeners', async t => {
  let finish!: (value: { routed: false }) => void;
  let received = 0;
  const h = harness(t, { receive: async () => { received++; return new Promise(resolve => { finish = resolve; }); } });
  h.raw.emit(Events.MessageCreate, h.message);
  h.raw.emit(Events.MessageCreate, h.message);
  await flush();
  assert.equal(received, 1);
  assert.match(h.dmSent[0].content as string, /still processing/);
  h.gateway.stop();
  finish({ routed: false });
  await flush();
  assert.equal(h.raw.listenerCount(Events.MessageCreate), 0);
  assert.equal(h.raw.listenerCount(Events.InteractionCreate), 0);
  assert.equal(h.dmSent.length, 1);
});
