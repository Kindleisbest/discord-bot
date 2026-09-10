import {
  ChannelType, DiscordAPIError, EmbedBuilder, GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel, HTTPError, PermissionFlagsBits, RateLimitError,
  type Client, type GuildBasedChannel, type GuildMember, type NewsChannel, type TextChannel,
} from 'discord.js';
import type { EventDraft, EventOptions } from '../../shared/events.js';
import { BotSendError } from '../bot/types.js';
import type { EventTransport } from './types.js';

const ID = /^\d{17,20}$/;
const EVENT_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreateEvents];
const VOICE_PERMISSIONS = [...EVENT_PERMISSIONS, PermissionFlagsBits.Connect];
const STAGE_PERMISSIONS = [...EVENT_PERMISSIONS, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers];
const ANNOUNCEMENT_PERMISSIONS = [PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

function eventChannel(channel: GuildBasedChannel | null, guildId: string, member: GuildMember): 'voice' | 'stage' | null {
  if (!channel || channel.guildId !== guildId) return null;
  const permissions = channel.permissionsFor(member);
  if (channel.type === ChannelType.GuildVoice && permissions?.has(VOICE_PERMISSIONS)) return 'voice';
  if (channel.type === ChannelType.GuildStageVoice && permissions?.has(STAGE_PERMISSIONS)) return 'stage';
  return null;
}

function announcementChannel(channel: GuildBasedChannel | null, guildId: string, member: GuildMember): channel is TextChannel | NewsChannel {
  return !!channel && channel.guildId === guildId
    && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    && !!channel.permissionsFor(member)?.has(ANNOUNCEMENT_PERMISSIONS);
}

function checkedImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
      && ['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname) && url.length <= 4096) return parsed.href;
  } catch { /* Untrusted or malformed image metadata is never fetched or embedded. */ }
  return null;
}

function failedPreflight(error: unknown): BotSendError {
  return error instanceof BotSendError ? error
    : new BotSendError('The server, event, and bot permissions could not be verified. Nothing was sent.', false);
}

function failedPost(error: unknown, action: 'event' | 'announcement'): BotSendError {
  if (error instanceof BotSendError) return error;
  const definite = error instanceof RateLimitError
    || ((error instanceof DiscordAPIError || error instanceof HTTPError) && error.status >= 400 && error.status < 500);
  return new BotSendError(definite
    ? `Discord rejected the ${action}. Check the bot permissions before trying again.`
    : `Discord did not confirm the ${action}. Check Discord before trying again.`, !definite);
}

export function createEventTransport(client: Client): EventTransport {
  function ready() {
    if (!client.isReady() || !client.user) throw new BotSendError('The bot is not connected to Discord.', false);
  }

  async function freshGuild(guildId: string) {
    ready();
    if (!ID.test(guildId)) throw new BotSendError('Choose a valid server.', false);
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    if (guild.id !== guildId) throw new BotSendError('The selected server could not be verified.', false);
    const [roles, member] = await Promise.all([guild.roles.fetch(), guild.members.fetchMe({ force: true })]);
    for (const id of guild.roles.cache.keys()) if (!roles.has(id)) guild.roles.cache.delete(id);
    if (member.id !== client.user?.id || member.guild.id !== guildId) {
      throw new BotSendError('The bot membership could not be verified.', false);
    }
    return { guild, member };
  }

  async function checkedDraft(guildId: string, draft: EventDraft) {
    try {
      if (!ID.test(draft.announcementChannelId)
        || !['external', 'voice', 'stage'].includes(draft.entityType)
        || (draft.entityType !== 'external' && (!draft.channelId || !ID.test(draft.channelId)))) {
        throw new BotSendError('Choose valid event and announcement channels.', false);
      }
      // The service validates image bytes. This guard also keeps Discord.js from resolving a remote URL.
      if (draft.graphic && (draft.graphic.data.length > 1_398_200
        || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(draft.graphic.data))) {
        throw new BotSendError('Choose a PNG or JPEG event graphic no larger than 1 MiB.', false);
      }
      const { guild, member } = await freshGuild(guildId);
      const [announcement, selected] = await Promise.all([
        guild.channels.fetch(draft.announcementChannelId, { force: true }),
        draft.entityType === 'external' ? Promise.resolve(null)
          : guild.channels.fetch(draft.channelId!, { force: true }),
      ]);
      if (!announcementChannel(announcement, guildId, member)) {
        throw new BotSendError('The bot needs View Channel, Send Messages, and Embed Links in the announcement channel.', false);
      }
      if (draft.entityType === 'external') {
        if (!member.permissions.has(PermissionFlagsBits.CreateEvents)) {
          throw new BotSendError('The bot needs Create Events permission in this server.', false);
        }
      } else if (eventChannel(selected, guildId, member) !== draft.entityType) {
        throw new BotSendError('The event channel is unavailable or the bot lacks the required event permissions.', false);
      }
      ready();
      return { guild };
    } catch (error) { throw failedPreflight(error); }
  }

  return {
    async options(guildId) {
      try {
        const { guild, member } = await freshGuild(guildId);
        const channels = await guild.channels.fetch();
        const result: EventOptions = {
          externalAllowed: member.permissions.has(PermissionFlagsBits.CreateEvents),
          eventChannels: [], announcementChannels: [],
        };
        for (const channel of channels.values()) {
          const type = eventChannel(channel, guildId, member);
          if (type && channel) result.eventChannels.push({ id: channel.id, name: channel.name, type });
          if (announcementChannel(channel, guildId, member)) result.announcementChannels.push({ id: channel.id, name: channel.name });
        }
        result.eventChannels.sort((a, b) => a.name.localeCompare(b.name));
        result.announcementChannels.sort((a, b) => a.name.localeCompare(b.name));
        return result;
      } catch (error) { throw failedPreflight(error); }
    },
    async preflight(guildId, draft) { await checkedDraft(guildId, draft); },
    async create(guildId, draft) {
      const { guild } = await checkedDraft(guildId, draft);
      try {
        const event = await guild.scheduledEvents.create({
          name: draft.name, ...(draft.description ? { description: draft.description } : {}),
          scheduledStartTime: draft.startTime, scheduledEndTime: draft.endTime,
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          entityType: draft.entityType === 'external' ? GuildScheduledEventEntityType.External
            : draft.entityType === 'voice' ? GuildScheduledEventEntityType.Voice : GuildScheduledEventEntityType.StageInstance,
          ...(draft.entityType === 'external' ? { entityMetadata: { location: draft.location! } } : { channel: draft.channelId! }),
          ...(draft.graphic ? { image: draft.graphic.data } : {}),
        });
        return { id: event.id };
      } catch (error) { throw failedPost(error, 'event'); }
    },
    async announce(guildId, eventId, draft, nonce) {
      let channel: TextChannel | NewsChannel;
      let embed: EmbedBuilder;
      try {
        if (!ID.test(eventId) || !ID.test(draft.announcementChannelId) || !/^[A-Za-z0-9_-]{1,25}$/.test(nonce)
          || typeof draft.announcementText !== 'string' || draft.announcementText.length > 2000) {
          throw new BotSendError('The event announcement request is invalid.', false);
        }
        const { guild, member } = await freshGuild(guildId);
        const [target, event] = await Promise.all([
          guild.channels.fetch(draft.announcementChannelId, { force: true }),
          guild.scheduledEvents.fetch({ guildScheduledEvent: eventId, force: true, cache: false }),
        ]);
        if (!announcementChannel(target, guildId, member)) {
          throw new BotSendError('The bot cannot post an event embed in that announcement channel.', false);
        }
        if (event.id !== eventId || event.guildId !== guildId || event.creatorId !== client.user?.id) {
          throw new BotSendError('The event does not belong to this server and bot.', false);
        }
        embed = new EmbedBuilder().setTitle(event.name).setURL(`https://discord.com/events/${guildId}/${eventId}`);
        if (event.description) embed.setDescription(event.description);
        if (event.scheduledStartTimestamp !== null) embed.addFields({
          name: 'Starts', value: `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`, inline: true,
        });
        if (event.scheduledEndTimestamp !== null) embed.addFields({
          name: 'Ends', value: `<t:${Math.floor(event.scheduledEndTimestamp / 1000)}:F>`, inline: true,
        });
        const location = event.entityType === GuildScheduledEventEntityType.External
          ? event.entityMetadata?.location : event.channelId && ID.test(event.channelId) ? `<#${event.channelId}>` : null;
        if (location) embed.addFields({ name: 'Location', value: location });
        const image = checkedImage(event.coverImageURL({ size: 1024 }));
        if (image) {
          embed.setImage(image);
          if (draft.graphicAlt) embed.addFields({ name: 'Graphic description', value: draft.graphicAlt.slice(0, 1024) });
        }
        channel = target;
        ready();
      } catch (error) { throw failedPreflight(error); }
      try {
        const message = await channel.send({
          ...(draft.announcementText ? { content: draft.announcementText } : {}), embeds: [embed],
          allowedMentions: { parse: [], repliedUser: false }, nonce, enforceNonce: true,
        });
        return { id: message.id };
      } catch (error) { throw failedPost(error, 'announcement'); }
    },
  };
}
