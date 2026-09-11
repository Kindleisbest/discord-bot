import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import { TutorialError, type TutorialChannel } from '../../shared/tutorial.js';
import type { TutorialTransport } from './types.js';

const ID = /^\d{17,20}$/;
const MAX_LOOKUPS = 3;
// Shared by all transport instances; rejected lookups do not enter a REST queue.
let activeLookups = 0;

export function createTutorialTransport(client: Client): TutorialTransport {
  return {
    async channels(guildId, userId) {
      if (typeof guildId !== 'string' || !ID.test(guildId)
        || (userId !== undefined && (typeof userId !== 'string' || !ID.test(userId)))) {
        throw new TutorialError(400, 'Choose a valid server and member.');
      }
      if (activeLookups >= MAX_LOOKUPS) {
        throw new TutorialError(429, 'Channel access is busy. Try again shortly.');
      }
      activeLookups++;
      try {
        if (!client.isReady() || !client.user) throw new Error('Bot unavailable');
        const botId = client.user.id;
        const guild = await client.guilds.fetch({ guild: guildId, force: true });
        if (guild.id !== guildId) throw new Error('Guild mismatch');

        // Complete one refresh before starting the next. This also keeps each
        // occupied lookup slot alive until all its REST work has settled.
        const roles = await guild.roles.fetch();
        for (const id of guild.roles.cache.keys()) {
          if (!roles.has(id)) guild.roles.cache.delete(id);
        }
        const bot = await guild.members.fetchMe({ force: true });
        if (bot.id !== botId || bot.guild.id !== guildId) throw new Error('Bot mismatch');
        const member = userId === undefined ? null
          : await guild.members.fetch({ user: userId, force: true, cache: false });
        if (userId !== undefined && (!member || member.id !== userId || member.guild.id !== guildId)) {
          throw new Error('Member mismatch');
        }

        const channels = await guild.channels.fetch();
        const result: TutorialChannel[] = [];
        for (const channel of channels.values()) {
          if (!channel || channel.guildId !== guildId || !ID.test(channel.id)) continue;
          switch (channel.type) {
            case ChannelType.GuildText:
            case ChannelType.GuildAnnouncement:
            case ChannelType.GuildVoice:
            case ChannelType.GuildStageVoice:
            case ChannelType.GuildForum:
            case ChannelType.GuildMedia:
              if (channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel)
                && (!member || channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))) {
                result.push({ id: channel.id, name: channel.name, type: channel.type, position: channel.rawPosition });
              }
          }
        }
        if (!client.isReady() || client.user?.id !== botId) throw new Error('Bot unavailable');
        return result.sort((a, b) => a.position - b.position
          || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
      } catch {
        // Discord failures can contain private channel/member metadata or URLs.
        throw new TutorialError(503, 'Channel access could not be verified. Try again shortly.');
      } finally {
        activeLookups--;
      }
    },
  };
}
