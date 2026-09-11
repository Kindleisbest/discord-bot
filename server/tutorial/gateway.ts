import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client,
  type Interaction, type InteractionEditReplyOptions,
} from 'discord.js';
import { TutorialError, type TutorialPage } from '../../shared/tutorial.js';
import type { TutorialGatewayService } from './types.js';

export const TUTORIAL_SESSION_LIFETIME_MS = 10 * 60_000;
export const TUTORIAL_MAX_SESSIONS = 1000;
export const TUTORIAL_MAX_LOOKUPS = 3;
const ID = /^\d{17,20}$/;
const COMPONENT = /^tutorial:([A-Za-z0-9_-]{32}):(previous|next|close)$/;
const MENTIONS = { parse: [] as never[], repliedUser: false };
const ERROR_LIFETIME_MS = 120_000;
const MAX_RATE_WINDOWS = 5000;
const ACTIONS_PER_MINUTE = 20;
type TutorialInteraction = ChatInputCommandInteraction | ButtonInteraction;
type Session = {
  guildId: string; userId: string; expiresAt: number; closed: boolean;
  previousChannelId: string | null; nextChannelId: string | null;
  deleteReply(): Promise<unknown>;
};
type RateWindow = { start: number; count: number };

function safeError(error: unknown): string {
  if (error instanceof TutorialError) {
    if (error.statusCode === 400) return 'Use /tutorial inside a server and choose a server channel.';
    if (error.statusCode === 403) return 'This tutorial session is unavailable. Run /tutorial to start your own.';
    if (error.statusCode === 404) return 'That tutorial step is no longer available to you. Run /tutorial to see the available steps.';
    if (error.statusCode === 410) return 'This tutorial session has expired. Run /tutorial to start again.';
    if (error.statusCode === 429) return 'Please wait a moment before using the tutorial again.';
  }
  return 'The tutorial is temporarily unavailable. Please try again shortly.';
}

function pagePayload(page: TutorialPage, token: string): InteractionEditReplyOptions {
  // Tutorial text is administrator-authored Discord markdown. Mentions cannot ping.
  const embed = new EmbedBuilder().setTitle(page.step.title.slice(0, 256))
    .setDescription(page.step.body.slice(0, 4096))
    .setFooter({ text: `Step ${page.index + 1} of ${page.total} · #${page.channel.name}`.slice(0, 2048) });
  return {
    content: `Tutorial for <#${page.channel.id}>. Only you can see this. This session closes after ten minutes.`,
    embeds: [embed], allowedMentions: MENTIONS,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tutorial:${token}:previous`).setLabel('Previous')
        .setStyle(ButtonStyle.Secondary).setDisabled(page.previousChannelId === null),
      new ButtonBuilder().setCustomId(`tutorial:${token}:next`).setLabel('Next')
        .setStyle(ButtonStyle.Primary).setDisabled(page.nextChannelId === null),
      new ButtonBuilder().setCustomId(`tutorial:${token}:close`).setLabel('Close').setStyle(ButtonStyle.Secondary),
    )],
  };
}

/** Only interaction replies are used; this gateway never reads or posts channel messages. */
export function attachTutorialGateway(client: Client, service: TutorialGatewayService): { stop(): void } {
  const sessions = new Map<string, Session>();
  const windows = new Map<string, RateWindow>();
  const activeUsers = new Set<string>();
  let stopped = false;
  let sweeping = false;

  function rate(userId: string): boolean {
    const now = Date.now();
    let window = windows.get(userId);
    if (!window || window.start + 60_000 <= now) {
      if (windows.size >= MAX_RATE_WINDOWS) {
        for (const [key, value] of windows) if (value.start + 60_000 <= now) windows.delete(key);
        if (windows.size >= MAX_RATE_WINDOWS && !window) return false;
      }
      window = { start: now, count: 0 };
      windows.set(userId, window);
    }
    return ++window.count <= ACTIONS_PER_MINUTE;
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const now = Date.now();
      for (const [key, value] of windows) if (stopped || value.start + 60_000 <= now) windows.delete(key);
      // Keep deletion work in the same bounded map and issue at most three REST
      // calls at once, even when many sessions expire together on a small host.
      while (true) {
        const expired: Session[] = [];
        for (const [token, session] of sessions) {
          if (stopped || session.expiresAt <= now) {
            sessions.delete(token);
            expired.push(session);
            if (expired.length === TUTORIAL_MAX_LOOKUPS) break;
          }
        }
        if (!expired.length) break;
        await Promise.allSettled(expired.map(session => Promise.resolve().then(() => session.deleteReply())));
      }
    } finally { sweeping = false; }
  }
  const cleanup = setInterval(() => { void sweep().catch(() => undefined); }, 30_000);
  cleanup.unref();

  function recognized(interaction: Interaction): interaction is TutorialInteraction {
    return (interaction.isChatInputCommand() && interaction.commandName === 'tutorial')
      || (interaction.isButton() && interaction.customId.startsWith('tutorial:'));
  }

  async function handle(interaction: TutorialInteraction) {
    const userId = interaction.user.id;
    const command = interaction.isChatInputCommand();
    const match = !command ? COMPONENT.exec(interaction.customId) : null;
    let token = match?.[1];
    let session = token ? sessions.get(token) : undefined;
    let rejection: TutorialError | undefined;
    if (!interaction.guildId || !ID.test(interaction.guildId) || !ID.test(userId)) rejection = new TutorialError(400, 'Invalid server.');
    else if (!command) {
      if (!session || session.closed || session.expiresAt <= Date.now()) rejection = new TutorialError(410, 'Expired session.');
      else if (session.guildId !== interaction.guildId || session.userId !== userId
        || !interaction.message.flags.has(MessageFlags.Ephemeral)) rejection = new TutorialError(403, 'Unavailable session.');
    }
    if (!rate(userId)) rejection = new TutorialError(429, 'Slow down.');
    if (!rejection && (activeUsers.has(userId) || activeUsers.size >= TUTORIAL_MAX_LOOKUPS)) {
      rejection = new TutorialError(429, 'Busy.');
    }
    const ownsSlot = !rejection;
    if (ownsSlot) activeUsers.add(userId);
    // Ownership and the ephemeral flag are checked before choosing update. A
    // forged/public/other-user component can only create a new private denial.
    const update = !command && !rejection;
    try {
      if (update) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (stopped) return;
      if (rejection) throw rejection;
      if (command) {
        const selected = interaction.options.getChannel('channel');
        if (selected && !ID.test(selected.id)) throw new TutorialError(400, 'Invalid channel.');
        if (sessions.size >= TUTORIAL_MAX_SESSIONS) throw new TutorialError(429, 'Sessions full.');
        token = randomBytes(24).toString('base64url');
        session = {
          guildId: interaction.guildId!, userId, expiresAt: Date.now() + TUTORIAL_SESSION_LIFETIME_MS,
          closed: true, previousChannelId: null, nextChannelId: null,
          deleteReply: () => interaction.deleteReply(),
        };
        sessions.set(token, session);
        await showPage(selected?.id);
      } else {
        // These values were checked synchronously above and cannot be supplied
        // by the client independently of its opaque session token.
        session!.deleteReply = () => interaction.deleteReply();
        if (match![2] === 'close') {
          session!.closed = true;
          try { await interaction.deleteReply(); sessions.delete(token!); }
          catch {
            session!.expiresAt = Date.now() + ERROR_LIFETIME_MS;
            await interaction.editReply({ content: 'Tutorial closed.', embeds: [], components: [], allowedMentions: MENTIONS });
          }
        } else {
          const target = match![2] === 'previous' ? session!.previousChannelId : session!.nextChannelId;
          if (!target) throw new TutorialError(404, 'No adjacent page.');
          await showPage(target);
        }
      }

      async function showPage(channelId?: string) {
        const page = await service.page(interaction.guildId!, userId, channelId);
        if (stopped) return;
        if (session!.expiresAt <= Date.now()) throw new TutorialError(410, 'Expired session.');
        if (!page) {
          if (channelId) throw new TutorialError(404, 'Unavailable page.');
          session!.closed = true;
          session!.expiresAt = Date.now() + ERROR_LIFETIME_MS;
          await interaction.editReply({
            content: 'There are no published tutorial steps available to you in this server yet.',
            embeds: [], components: [], allowedMentions: MENTIONS,
          });
          return;
        }
        if (!ID.test(page.channel.id) || page.step.channelId !== page.channel.id || !page.step.published
          || (channelId && page.channel.id !== channelId)
          || !Number.isSafeInteger(page.index) || !Number.isSafeInteger(page.total)
          || page.index < 0 || page.total <= page.index
          || [page.previousChannelId, page.nextChannelId].some(id => id !== null && !ID.test(id))) {
          throw new Error('Invalid tutorial page.');
        }
        session!.closed = false;
        session!.previousChannelId = page.previousChannelId;
        session!.nextChannelId = page.nextChannelId;
        await interaction.editReply(pagePayload(page, token!));
      }
    } catch (error) {
      if (stopped) return;
      // A failed refresh removes previously displayed text and navigation. A
      // rejected forged click never touches the real owner's existing reply.
      if (ownsSlot && session && token) {
        session.closed = true;
        session.expiresAt = Math.min(session.expiresAt, Date.now() + ERROR_LIFETIME_MS);
      }
      try {
        const payload = { content: safeError(error), embeds: [], components: [], allowedMentions: MENTIONS };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch { /* Never expose token-bearing Discord exceptions. */ }
    } finally { if (ownsSlot) activeUsers.delete(userId); }
  }

  const listener = (interaction: Interaction) => {
    if (!stopped && recognized(interaction)) void handle(interaction).catch(() => undefined);
  };
  client.on(Events.InteractionCreate, listener);
  return { stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(cleanup);
    windows.clear(); activeUsers.clear();
    client.off(Events.InteractionCreate, listener);
    void sweep().catch(() => undefined);
  } };
}
