import {
  ChannelType, Client, DiscordAPIError, Events, GatewayIntentBits, HTTPError,
  Options, Partials, PermissionFlagsBits, RateLimitError, type GuildMember,
  type GuildBasedChannel, type NewsChannel, type TextChannel,
} from 'discord.js';
import type { Config } from '../config.js';
import { commandDefinitions, createCommandHandler } from './commands.js';
import {
  BotSendError, BotUnavailableError, type BotService, type BotStatus,
  type SendMessageInput, type SendableChannel,
} from './types.js';

type Hooks = {
  addActivity(guildId: string, actorId: string, action: string, targetId?: string | null): void;
  removeGuild(guildId: string): void;
};

function sendable(channel: GuildBasedChannel | null, guildId: string, member: GuildMember): channel is TextChannel | NewsChannel {
  if (!channel || channel.guildId !== guildId
    || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return false;
  const permissions = channel.permissionsFor(member);
  return !!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
}

export function validateSendInput(input: SendMessageInput): void {
  if (!/^\d{17,20}$/.test(input.guildId) || !/^\d{17,20}$/.test(input.channelId)) {
    throw new BotSendError('Choose a valid server and channel.', false);
  }
  if (typeof input.content !== 'string' || input.content.length < 1 || input.content.length > 2000
    || input.content.trim().length === 0) {
    throw new BotSendError('Messages must contain between 1 and 2,000 characters.', false);
  }
  if (typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{1,25}$/.test(input.nonce)) {
    throw new BotSendError('The message request identifier is invalid.', false);
  }
}

export function classifySendError(error: unknown): BotSendError {
  if (error instanceof BotSendError) return error;
  const definite = error instanceof RateLimitError
    || ((error instanceof DiscordAPIError || error instanceof HTTPError) && error.status >= 400 && error.status < 500);
  return new BotSendError(definite
    ? 'Discord rejected the message. Check the channel and bot permissions before trying again.'
    : 'Discord did not confirm delivery. Check the channel before sending another message.', !definite);
}

export function createBot(config: Config, hooks: Hooks): BotService & { client: Client; start(): Promise<void> } {
  const client: Client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages,
      ...(config.INSTAGRAM_LINKS_ENABLED ? [GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent] : [])],
    partials: [Partials.Channel],
    allowedMentions: { parse: [], repliedUser: false },
    // Guild, channel, role and overwrite caches must remain intact for Discord
    // permission resolution. Keep message content and unused entities uncached.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings, MessageManager: 0,
      GuildMemberManager: { maxSize: 50, keepOverLimit: member => member.id === client.user?.id },
      UserManager: { maxSize: 50, keepOverLimit: user => user.id === client.user?.id },
      PresenceManager: 0, GuildEmojiManager: 0, GuildStickerManager: 0,
      ReactionManager: 0, ReactionUserManager: 0, GuildScheduledEventManager: 0,
    }),
    // Never automatically replay a message POST after an uncertain network error.
    rest: { retries: 0, timeout: 15_000, rejectOnRateLimit: ['/channels', '/guilds'] },
  });
  let current: BotStatus = { state: config.configured ? 'disconnected' : 'not_configured', lastReadyAt: null };
  let starting: Promise<void> | null = null;
  let stopped = false;
  let commandsRegistered = false;
  const safeActivity: Hooks['addActivity'] = (...args) => {
    try { hooks.addActivity(...args); } catch { /* Never log private callback errors. */ }
  };
  const commands = createCommandHandler(client, config, safeActivity);

  const requireReady = () => {
    if (stopped || !config.configured || !client.isReady()) {
      throw new BotUnavailableError('The bot is not connected to Discord. Try again once it is ready.');
    }
  };
  async function freshGuild(guildId: string) {
    requireReady();
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    const [roles, member] = await Promise.all([guild.roles.fetch(), guild.members.fetchMe({ force: true })]);
    // The role fetch API updates known entries but does not evict deleted roles.
    for (const id of guild.roles.cache.keys()) if (!roles.has(id)) guild.roles.cache.delete(id);
    return { guild, member };
  }

  client.on(Events.ClientReady, readyClient => {
    if (stopped) return;
    current = { state: 'ready', lastReadyAt: Date.now() };
    for (const guild of readyClient.guilds.cache.values()) safeActivity(guild.id, readyClient.user.id, 'bot.connected');
    if (!commandsRegistered) {
      void (async () => {
        // Create is an upsert by command name. Never bulk-replace other commands.
        for (const definition of commandDefinitions()) {
          if (stopped) return;
          await readyClient.application.commands.create(definition);
        }
        commandsRegistered = true;
      })().catch(() => {
        for (const guild of readyClient.guilds.cache.values()) {
          safeActivity(guild.id, readyClient.user.id, 'bot.commands_registration_failed');
        }
      });
    }
  });
  client.on(Events.ShardReconnecting, () => { if (!stopped) current = { ...current, state: 'connecting' }; });
  client.on(Events.ShardDisconnect, () => { current = { ...current, state: 'disconnected' }; });
  client.on(Events.ShardResume, () => {
    if (!stopped && client.isReady()) current = { state: 'ready', lastReadyAt: Date.now() };
  });
  client.on(Events.Error, () => { /* Error payloads may include sensitive Discord request details. */ });
  client.on(Events.ShardError, () => { /* Reconnect/disconnect events own the connection status. */ });
  client.on(Events.GuildCreate, guild => {
    if (client.user) safeActivity(guild.id, client.user.id, 'bot.joined');
  });
  client.on(Events.GuildDelete, guild => {
    try { hooks.removeGuild(guild.id); } catch { /* Removal must not expose stored server data. */ }
  });
  client.on(Events.InteractionCreate, interaction => {
    if (interaction.isChatInputCommand()) void commands.handle(interaction);
  });

  return {
    client,
    status: () => ({ ...current }),
    async start() {
      if (!config.configured) return;
      if (stopped) throw new BotUnavailableError('The bot has been stopped. Restart the application.');
      if (client.isReady()) return;
      if (!starting) {
        current = { ...current, state: 'connecting' };
        starting = client.login(config.DISCORD_BOT_TOKEN).then(() => undefined).catch(() => {
          current = { ...current, state: 'disconnected' };
          throw new BotUnavailableError('Discord connection failed. Check the bot configuration and network.');
        }).finally(() => { starting = null; });
      }
      await starting;
    },
    async listSendableChannels(guildId) {
      const { guild, member } = await freshGuild(guildId);
      const channels = await guild.channels.fetch();
      const result: SendableChannel[] = [];
      for (const channel of channels.values()) {
        if (sendable(channel, guild.id, member)) result.push({ id: channel.id, name: channel.name, type: channel.type });
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    },
    async sendMessage(input) {
      requireReady();
      validateSendInput(input);
      let channel: TextChannel | NewsChannel;
      try {
        const { guild, member } = await freshGuild(input.guildId);
        const fetched = await guild.channels.fetch(input.channelId, { force: true });
        if (!sendable(fetched, input.guildId, member)) {
          throw new BotSendError('The bot cannot send messages in that channel.', false);
        }
        channel = fetched;
        requireReady();
      } catch (error) {
        if (error instanceof BotUnavailableError || error instanceof BotSendError) throw error;
        throw new BotSendError('The channel and bot permissions could not be verified. No message was sent.', false);
      }
      try {
        const message = await channel.send({
          content: input.content, allowedMentions: { parse: [], repliedUser: false },
          nonce: input.nonce, enforceNonce: true,
        });
        return { id: message.id, channelId: message.channelId };
      } catch (error) { throw classifySendError(error); }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      commands.stop();
      current = { ...current, state: config.configured ? 'disconnected' : 'not_configured' };
      await client.destroy();
    },
  };
}
