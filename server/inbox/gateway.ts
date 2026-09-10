import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, DiscordAPIError,
  EmbedBuilder, Events, HTTPError, MessageFlags, StringSelectMenuBuilder,
  escapeMarkdown, type Attachment, type ButtonInteraction, type ChatInputCommandInteraction,
  type Client, type Interaction, type Message, type MessageCreateOptions, type StringSelectMenuInteraction,
} from 'discord.js';
import { InboxError, type InboxAttachment } from '../../shared/inbox.js';
import { classifySendError } from '../bot/gateway.js';
import { scheduleEphemeralDeletion } from '../bot/commands.js';
import { BotSendError, BotUnavailableError } from '../bot/types.js';
import type { InboxGatewayService, InboxTransport } from './types.js';

const ID = /^\d{17,20}$/;
const NOTICE = 'Messages are retained for 90 days. Attachments are links and may expire.';
const MENTIONS = { parse: [] as [], repliedUser: false };
const cleanName = (value: string, limit: number) => value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) || 'Server';
const guildLabel = (value: string) => escapeMarkdown(cleanName(value, 100));
const safeError = (error: unknown) => error instanceof InboxError
  ? error.message : 'The staff inbox is temporarily unavailable. Please try again later.';

export function createInboxTransport(client: Client): InboxTransport {
  function ready() {
    if (!client.isReady()) throw new BotUnavailableError('The bot is not connected to Discord.');
  }
  async function verifyMember(guildId: string, userId: string) {
    ready();
    if (!ID.test(guildId) || !ID.test(userId)) throw new InboxError(400, 'Choose a valid server and member.');
    try {
      const guild = await client.guilds.fetch({ guild: guildId, force: true });
      const member = await guild.members.fetch({ user: userId, force: true, cache: false });
      if (guild.id !== guildId || member.id !== userId) throw new InboxError(403, 'Current server membership could not be verified.');
      return { id: guild.id, name: guild.name };
    } catch (error) {
      if (error instanceof InboxError) throw error;
      if ((error instanceof DiscordAPIError || error instanceof HTTPError) && [403, 404].includes(error.status)) {
        throw new InboxError(error.status, 'You must currently belong to this server to contact its staff.');
      }
      throw new InboxError(503, 'Current server membership could not be verified. Try again shortly.');
    }
  }
  return {
    verifyMember,
    async eligibleGuilds(userId, guildIds) {
      ready();
      const eligible: { id: string; name: string }[] = [];
      const ids = [...new Set(guildIds)];
      for (let index = 0; index < ids.length && eligible.length < 25; index += 3) {
        const batch = await Promise.allSettled(ids.slice(index, index + 3).map(id => verifyMember(id, userId)));
        for (const result of batch) {
          if (result.status === 'fulfilled') eligible.push(result.value);
          else if (!(result.reason instanceof InboxError && [403, 404].includes(result.reason.statusCode))) throw result.reason;
        }
      }
      return eligible.slice(0, 25);
    },
    async sendReply(input) {
      ready();
      if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 2000
        || !/^[A-Za-z0-9_-]{1,25}$/.test(input.nonce)) {
        throw new BotSendError('Replies require 1–2,000 characters and a valid request identifier.', false);
      }
      let channel;
      let guild;
      try {
        guild = await verifyMember(input.guildId, input.memberId);
        channel = await client.users.createDM(input.memberId, { force: true });
        ready();
      } catch {
        throw new BotSendError('Membership or direct-message access could not be verified. No reply was sent.', false);
      }
      try {
        const message = await channel.send({
          embeds: [new EmbedBuilder().setTitle(`${cleanName(guild.name, 250)} staff`).setDescription(input.content)],
          allowedMentions: MENTIONS, nonce: input.nonce, enforceNonce: true,
        });
        return { id: message.id };
      } catch (error) { throw classifySendError(error); }
    },
  };
}

/** Retain only Discord-hosted attachment metadata; never fetch attachment bytes. */
export function attachmentMetadata(attachments: Iterable<Pick<Attachment, 'id' | 'name' | 'url' | 'size'>>): InboxAttachment[] {
  const result: InboxAttachment[] = [];
  for (const attachment of attachments) {
    if (result.length === 10) break;
    try {
      const url = new URL(attachment.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
        || url.href.length > 4096 || !ID.test(attachment.id)
        || !Number.isSafeInteger(attachment.size) || attachment.size < 0) continue;
      result.push({ id: attachment.id, name: cleanName(attachment.name || 'Attachment', 256), url: url.href, size: attachment.size });
    } catch { /* Ignore malformed and external URLs. */ }
  }
  return result;
}

type InboxInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;
type Window = { start: number; count: number; warned: boolean };

export function attachInboxGateway(client: Client, service: InboxGatewayService): { stop(): void } {
  const windows = new Map<string, Window>();
  const activeUsers = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  function prune() {
    const cutoff = Date.now() - 60_000;
    for (const [id, window] of windows) if (window.start <= cutoff) windows.delete(id);
  }
  const cleanup = setInterval(prune, 60_000);
  cleanup.unref();
  function rate(userId: string): 'allow' | 'warn' | 'drop' {
    const now = Date.now();
    let window = windows.get(userId);
    if (!window || window.start + 60_000 <= now) {
      if (windows.size >= 5000) prune();
      if (windows.size >= 5000 && !windows.has(userId)) return 'drop';
      window = { start: now, count: 0, warned: false }; windows.set(userId, window);
    }
    if (++window.count <= 10) return 'allow';
    if (!window.warned) { window.warned = true; return 'warn'; }
    return 'drop';
  }
  function switchButton() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('inbox:switch').setLabel('Switch server').setStyle(ButtonStyle.Secondary),
    );
  }
  async function chooser(userId: string) {
    const choice = await service.choices(userId);
    const guilds = choice.guilds.filter(guild => ID.test(guild.id)).slice(0, 25);
    if (!guilds.length) return {
      content: `There are no servers available with a staff inbox enabled for your account. ${NOTICE}`,
      components: [], allowedMentions: MENTIONS,
    };
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(choice.token)) throw new Error('Invalid choice token.');
    return {
      content: `Choose the server whose staff should receive your messages, then resend your message. Your first message has not been saved or forwarded. ${NOTICE}`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`inbox:choose:${choice.token}`)
          .setPlaceholder('Choose a server').setMinValues(1).setMaxValues(1)
          .addOptions(guilds.map(guild => ({ label: cleanName(guild.name, 100), value: guild.id }))),
      )], allowedMentions: MENTIONS,
    };
  }
  async function dm(message: Message, payload: MessageCreateOptions) {
    if (stopped || message.channel.type !== ChannelType.DM) return;
    try {
      await message.channel.send({
        ...payload, allowedMentions: MENTIONS, flags: MessageFlags.SuppressEmbeds,
      });
    } catch { /* Blocked DMs and transient transport errors never reach logs. */ }
  }
  async function onMessage(message: Message) {
    if (stopped || message.guildId || message.author.bot || message.channel.type !== ChannelType.DM) return;
    const userId = message.author.id;
    const limit = rate(userId);
    if (limit === 'drop') return;
    if (limit === 'warn') { await dm(message, { content: 'Please wait one minute before sending more staff inbox messages.' }); return; }
    if (activeUsers.has(userId) || activeUsers.size >= 8) {
      await dm(message, { content: 'The inbox is still processing messages. Please wait a moment, then resend this message.' }); return;
    }
    activeUsers.add(userId);
    try {
      if (message.content.length > 4000) throw new InboxError(400, 'Please shorten your message to 4,000 characters or fewer and resend it.');
      const attachments = attachmentMetadata(message.attachments.values());
      if (!message.content.trim() && !attachments.length) throw new InboxError(400, 'Send text or a Discord attachment to contact staff.');
      const result = await service.receive({
        memberId: userId, discordMessageId: message.id, content: message.content,
        attachments, createdAt: message.createdTimestamp,
      });
      if (stopped) return;
      if (!result.routed) await dm(message, await chooser(userId));
      else if (result.created) await dm(message, {
        content: `Your message was sent to staff at **${guildLabel(result.guildName)}**. ${NOTICE}`,
        components: [switchButton()],
      });
    } catch (error) { await dm(message, { content: safeError(error) }); }
    finally { activeUsers.delete(userId); }
  }
  function recognized(interaction: Interaction): interaction is InboxInteraction {
    return (interaction.isChatInputCommand() && interaction.commandName === 'contact')
      || (interaction.isButton() && ['inbox:contact', 'inbox:switch'].includes(interaction.customId))
      || (interaction.isStringSelectMenu() && interaction.customId.startsWith('inbox:choose:'));
  }
  async function onInteraction(interaction: Interaction) {
    if (stopped || !recognized(interaction)) return;
    const userId = interaction.user.id;
    let ownsSlot = false;
    try {
      const guildReply = !!interaction.guildId;
      if (!guildReply && !interaction.isChatInputCommand()) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (rate(userId) !== 'allow') throw new InboxError(429, 'Please wait one minute before using the staff inbox again.');
      if (activeUsers.has(userId) || activeUsers.size >= 8) throw new InboxError(429, 'Please wait for your previous inbox action, then try again.');
      activeUsers.add(userId); ownsSlot = true;
      if (interaction.isChatInputCommand() || (interaction.isButton() && interaction.customId === 'inbox:contact')) {
        if (!interaction.guildId || !client.user) throw new InboxError(400, 'Use /contact inside the server whose staff you want to contact.');
        const guild = await service.contact(interaction.guildId, userId);
        if (!stopped) await interaction.editReply({
          content: `Your messages will go to staff at **${guildLabel(guild.name)}**. DM this bot to start. ${NOTICE}`,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel('Message this bot').setStyle(ButtonStyle.Link)
              .setURL(`https://discord.com/users/${client.user.id}`),
          )], allowedMentions: MENTIONS,
        });
      } else {
        if (interaction.guildId) throw new InboxError(400, 'Choose or switch servers in your direct messages with this bot.');
        if (interaction.isStringSelectMenu()) {
          const token = interaction.customId.slice('inbox:choose:'.length);
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(token) || interaction.values.length !== 1 || !ID.test(interaction.values[0])) {
            throw new InboxError(400, 'This server choice is invalid. Use Switch server to choose again.');
          }
          const guild = await service.choose(token, userId, interaction.values[0]);
          if (!stopped) await interaction.editReply({
            content: `Your messages will go to staff at **${guildLabel(guild.name)}**. Resend your message to start. ${NOTICE}`,
            components: [switchButton()], allowedMentions: MENTIONS,
          });
        } else {
          const payload = await chooser(userId);
          if (!stopped) await interaction.editReply(payload);
        }
      }
    } catch (error) {
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: safeError(error), components: [], allowedMentions: MENTIONS });
        else await interaction.reply({ content: safeError(error), flags: MessageFlags.Ephemeral, allowedMentions: MENTIONS });
      } catch { /* No token-bearing Discord errors are logged. */ }
    } finally {
      if (ownsSlot) activeUsers.delete(userId);
      if (!stopped && interaction.guildId && (interaction.deferred || interaction.replied)) {
        const timer = scheduleEphemeralDeletion(() => { timers.delete(timer); return interaction.deleteReply(); });
        timers.add(timer);
      }
    }
  }
  const messageListener = (message: Message) => { void onMessage(message).catch(() => undefined); };
  const interactionListener = (interaction: Interaction) => { void onInteraction(interaction).catch(() => undefined); };
  client.on(Events.MessageCreate, messageListener);
  client.on(Events.InteractionCreate, interactionListener);
  return { stop() {
    stopped = true; clearInterval(cleanup);
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); windows.clear();
    client.off(Events.MessageCreate, messageListener);
    client.off(Events.InteractionCreate, interactionListener);
  } };
}
