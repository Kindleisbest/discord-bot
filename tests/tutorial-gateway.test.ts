import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { type TestContext } from 'node:test';
import { ChannelType, Events, MessageFlags, type Client, type InteractionEditReplyOptions } from 'discord.js';
import { TutorialError, type TutorialPage } from '../shared/tutorial.js';
import {
  attachTutorialGateway, TUTORIAL_MAX_LOOKUPS, TUTORIAL_MAX_SESSIONS, TUTORIAL_SESSION_LIFETIME_MS,
} from '../server/tutorial/gateway.js';
import type { TutorialGatewayService } from '../server/tutorial/types.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const OTHER = '100000000000000003';
const CHANNEL = '100000000000000004';
const NEXT = '100000000000000005';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const serialize = (value: unknown) => JSON.parse(JSON.stringify(value));

function page(channelId = CHANNEL): TutorialPage {
  return {
    channel: { id: channelId, name: 'welcome', type: ChannelType.GuildText, position: 0 },
    step: { channelId, title: 'Getting started', body: '**Welcome** @everyone', published: true, revision: 1, updatedAt: 1 },
    index: channelId === CHANNEL ? 0 : 1, total: 2,
    previousChannelId: channelId === CHANNEL ? null : CHANNEL,
    nextChannelId: channelId === CHANNEL ? NEXT : null,
  };
}

function harness(t: TestContext, lookup?: TutorialGatewayService['page']) {
  const client = new EventEmitter();
  const events: string[] = [];
  const calls: unknown[][] = [];
  const service: TutorialGatewayService = { page: async (...args) => {
    events.push('lookup'); calls.push(args);
    return lookup ? lookup(...args) : page(args[2]);
  } };
  const gateway = attachTutorialGateway(client as Client, service);
  t.after(() => gateway.stop());
  function interaction(kind: 'command' | 'button' = 'command', customId = '', userId = USER) {
    const edits: InteractionEditReplyOptions[] = [];
    const acknowledgements: unknown[] = [];
    let deleted = 0;
    const raw = {
      commandName: 'tutorial', customId, user: { id: userId }, guildId: GUILD as string | null,
      message: { flags: { has: (flag: MessageFlags): boolean => flag === MessageFlags.Ephemeral } },
      options: { getChannel: () => null as { id: string } | null }, deferred: false, replied: false,
      isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button',
      deferReply: async (options: unknown) => { events.push('defer'); acknowledgements.push(options); raw.deferred = true; },
      deferUpdate: async () => { events.push('update'); acknowledgements.push('update'); raw.deferred = true; },
      editReply: async (payload: InteractionEditReplyOptions) => { edits.push(payload); },
      reply: async (payload: unknown) => { acknowledgements.push(payload); raw.replied = true; },
      deleteReply: async () => { deleted++; },
    };
    return { raw, edits, acknowledgements, get deleted() { return deleted; } };
  }
  async function send(target: ReturnType<typeof interaction>) {
    client.emit(Events.InteractionCreate, target.raw);
    await flush();
  }
  return { client, gateway, service, calls, events, interaction, send };
}

function buttonId(reply: { edits: InteractionEditReplyOptions[] }, label: string): string {
  return serialize(reply.edits.at(-1)).components[0].components.find((button: { label: string }) => button.label === label).custom_id;
}

test('tutorial acknowledges privately before lookup and renders an opaque private page with mentions suppressed', async t => {
  const h = harness(t);
  const command = h.interaction();
  await h.send(command);
  assert.deepEqual(h.events, ['defer', 'lookup']);
  assert.deepEqual(command.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(h.calls, [[GUILD, USER, undefined]]);
  const payload = serialize(command.edits[0]);
  assert.equal(payload.embeds[0].description, '**Welcome** @everyone');
  assert.equal(payload.embeds[0].footer.text, 'Step 1 of 2 · #welcome');
  assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
  assert.deepEqual(payload.components[0].components.map((b: { label: string; disabled?: boolean }) => [b.label, b.disabled]),
    [['Previous', true], ['Next', false], ['Close', undefined]]);
  const next = buttonId(command, 'Next');
  assert.match(next, /^tutorial:[A-Za-z0-9_-]{32}:next$/);
  for (const secret of [USER, GUILD, NEXT]) assert.equal(next.includes(secret), false);
  assert.equal(h.client.listenerCount(Events.MessageCreate), 0);
});

test('an explicit starting channel is passed to fresh service authorization', async t => {
  const h = harness(t);
  const command = h.interaction();
  command.raw.options.getChannel = () => ({ id: NEXT });
  await h.send(command);
  assert.deepEqual(h.calls, [[GUILD, USER, NEXT]]);
  assert.equal(serialize(command.edits[0]).embeds[0].footer.text, 'Step 2 of 2 · #welcome');
});

test('navigation acknowledges first and validates the server-recorded destination again for every click', async t => {
  const h = harness(t);
  const command = h.interaction(); await h.send(command);
  const next = h.interaction('button', buttonId(command, 'Next')); await h.send(next);
  assert.deepEqual(next.acknowledgements, ['update']);
  const previous = h.interaction('button', buttonId(next, 'Previous')); await h.send(previous);
  assert.deepEqual(h.calls, [[GUILD, USER, undefined], [GUILD, USER, NEXT], [GUILD, USER, CHANNEL]]);
  assert.deepEqual(h.events, ['defer', 'lookup', 'update', 'lookup', 'update', 'lookup']);
});

test('another user, another guild, or a public component only receives a private denial', async t => {
  const h = harness(t);
  const command = h.interaction(); await h.send(command);
  const token = buttonId(command, 'Next');
  const stranger = h.interaction('button', token, OTHER);
  const otherGuild = h.interaction('button', token); otherGuild.raw.guildId = OTHER;
  const publicMessage = h.interaction('button', token); publicMessage.raw.message.flags.has = () => false;
  for (const forged of [stranger, otherGuild, publicMessage]) {
    await h.send(forged);
    assert.deepEqual(forged.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
    assert.deepEqual(forged.edits[0].embeds, []);
  }
  assert.equal(h.calls.length, 1);
  const valid = h.interaction('button', token); await h.send(valid);
  assert.equal(h.calls.length, 2);
});

test('revoked access clears the old page, closes its controls, and never reflects service errors', async t => {
  const h = harness(t);
  const command = h.interaction(); await h.send(command);
  h.service.page = async () => { throw new TutorialError(404, 'hidden-channel-name secret-token'); };
  const next = h.interaction('button', buttonId(command, 'Next')); await h.send(next);
  assert.deepEqual(next.acknowledgements, ['update']);
  assert.match(next.edits[0].content as string, /no longer available/);
  assert.deepEqual(next.edits[0].embeds, []);
  assert.deepEqual(next.edits[0].components, []);
  assert.equal(JSON.stringify(next.edits).includes('secret'), false);
  const replay = h.interaction('button', buttonId(command, 'Next')); await h.send(replay);
  assert.deepEqual(replay.acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
});

test('empty tutorials, missing explicit steps, and unavailable Discord receive safe private replies', async t => {
  const h = harness(t, async () => null);
  const command = h.interaction(); await h.send(command);
  assert.match(command.edits[0].content as string, /no published tutorial/);
  assert.deepEqual(command.edits[0].components, []);
  const explicit = h.interaction(); explicit.raw.options.getChannel = () => ({ id: NEXT }); await h.send(explicit);
  assert.match(explicit.edits[0].content as string, /no longer available/);
  h.service.page = async () => { throw new Error('private-discord-token'); };
  const unavailable = h.interaction(); await h.send(unavailable);
  assert.match(unavailable.edits[0].content as string, /temporarily unavailable/);
  assert.equal(JSON.stringify(unavailable.edits).includes('private-discord'), false);
});

test('malformed tokens, disabled navigation, and direct-message commands perform no unauthorized lookups', async t => {
  const h = harness(t);
  const dm = h.interaction(); dm.raw.guildId = null; await h.send(dm);
  const malformed = h.interaction('button', `tutorial:${NEXT}:next`); await h.send(malformed);
  assert.deepEqual(h.calls, []);
  const command = h.interaction(); await h.send(command);
  const previous = h.interaction('button', buttonId(command, 'Previous')); await h.send(previous);
  assert.equal(h.calls.length, 1);
  assert.match(previous.edits[0].content as string, /no longer available/);
});

test('close deletes the private reply, retires its token, and needs no new lookup', async t => {
  const h = harness(t);
  const command = h.interaction(); await h.send(command);
  const close = h.interaction('button', buttonId(command, 'Close')); await h.send(close);
  assert.deepEqual(close.acknowledgements, ['update']);
  assert.equal(close.deleted, 1);
  assert.equal(h.calls.length, 1);
  const replay = h.interaction('button', buttonId(command, 'Next')); await h.send(replay);
  assert.match(replay.edits[0].content as string, /expired/);
});

test('expired tokens fail at exactly ten minutes and the single cleanup timer deletes their replies', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 });
  const h = harness(t);
  const command = h.interaction(); await h.send(command);
  t.mock.timers.tick(TUTORIAL_SESSION_LIFETIME_MS);
  await flush();
  const expired = h.interaction('button', buttonId(command, 'Next')); await h.send(expired);
  assert.equal(command.deleted, 1);
  assert.match(expired.edits[0].content as string, /expired/);
  assert.equal(h.calls.length, 1);
});

test('per-user throttling does not start excess lookups', async t => {
  const h = harness(t, async () => null);
  for (let index = 0; index < 21; index++) await h.send(h.interaction());
  assert.equal(h.calls.length, 20);
});

test('simultaneous actions by one user and global excess actions are rejected without queueing', async t => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const h = harness(t, async () => { await pending; return page(); });
  const first = h.interaction(); await h.send(first);
  const duplicate = h.interaction(); await h.send(duplicate);
  assert.match(duplicate.edits[0].content as string, /wait a moment/);
  for (let index = 1; index < TUTORIAL_MAX_LOOKUPS; index++) {
    await h.send(h.interaction('command', '', (100000000000000020n + BigInt(index)).toString()));
  }
  const overLimit = h.interaction('command', '', OTHER); await h.send(overLimit);
  assert.equal(h.calls.length, TUTORIAL_MAX_LOOKUPS);
  assert.match(overLimit.edits[0].content as string, /wait a moment/);
  finish(); await flush();
});

test('session storage is capped at one thousand and a closed session frees capacity', async t => {
  const h = harness(t);
  const first = h.interaction(); await h.send(first);
  for (let index = 1; index < TUTORIAL_MAX_SESSIONS; index++) {
    await h.send(h.interaction('command', '', (200000000000000000n + BigInt(index)).toString()));
  }
  const full = h.interaction('command', '', OTHER); await h.send(full);
  assert.equal(h.calls.length, TUTORIAL_MAX_SESSIONS);
  assert.match(full.edits[0].content as string, /wait a moment/);
  const close = h.interaction('button', buttonId(first, 'Close')); await h.send(close);
  await h.send(h.interaction('command', '', OTHER));
  assert.equal(h.calls.length, TUTORIAL_MAX_SESSIONS + 1);
});

test('stop detaches the listener, deletes outstanding pages, and suppresses a late lookup result', async t => {
  let finish!: (value: TutorialPage) => void;
  const h = harness(t);
  const shown = h.interaction(); await h.send(shown);
  h.service.page = async () => new Promise(resolve => { finish = resolve; });
  const pending = h.interaction('command', '', OTHER); await h.send(pending);
  h.gateway.stop();
  finish(page()); await flush();
  assert.equal(h.client.listenerCount(Events.InteractionCreate), 0);
  assert.equal(shown.deleted, 1);
  assert.equal(pending.deleted, 1);
  assert.deepEqual(pending.edits, []);
});

test('a service response for another channel or an unpublished step is never displayed', async t => {
  const h = harness(t, async () => page());
  const wrong = h.interaction(); wrong.raw.options.getChannel = () => ({ id: NEXT }); await h.send(wrong);
  assert.deepEqual(wrong.edits[0].embeds, []);
  h.service.page = async () => ({ ...page(), step: { ...page().step, published: false } });
  const draft = h.interaction(); await h.send(draft);
  assert.deepEqual(draft.edits[0].embeds, []);
});
