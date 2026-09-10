import {
  ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle,
  InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
  type ChatInputCommandInteraction, type Client,
} from 'discord.js';
import type { Config } from '../config.js';
import { resolveAccess, type GuildAccessInput } from '../permissions.js';

export const EPHEMERAL_LIFETIME_MS = 120_000;
export type CommandAccess = { inGuild: boolean; administrator: boolean };
export const COMMANDS = [
  { name: 'help', description: 'Show the commands you can use.', administrator: false },
  { name: 'dashboard', description: 'Open this server’s administration website.', administrator: true },
  { name: 'ping', description: 'Check whether the bot is responding.', administrator: false },
  { name: 'contact', description: 'Choose this server’s staff inbox, then message the bot privately.', administrator: false },
] as const;
export type CommandName = typeof COMMANDS[number]['name'];

export function commandAccess(input: GuildAccessInput | null): CommandAccess {
  return { inGuild: input !== null, administrator: input !== null && resolveAccess(input).allowed };
}

export function canUseCommand(name: string, access: CommandAccess): boolean {
  const command = COMMANDS.find(item => item.name === name);
  return !!command && access.inGuild && (!command.administrator || access.administrator);
}

export function visibleCommands(access: CommandAccess) {
  return COMMANDS.filter(command => canUseCommand(command.name, access));
}

export function helpText(access: CommandAccess): string {
  return ['**Your available commands**',
    ...visibleCommands(access).map(command => `/${command.name} — ${command.description}`),
    '', 'Only you can see this reply. It expires after two minutes.',
  ].join('\n');
}

export function commandDefinitions() {
  return COMMANDS.map(command => {
    const definition = new SlashCommandBuilder().setName(command.name)
      .setDescription(command.description).setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
    if (command.administrator) definition.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    return definition.toJSON();
  });
}

export function scheduleEphemeralDeletion(
  deleteReply: () => Promise<unknown>, lifetimeMs = EPHEMERAL_LIFETIME_MS,
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    // Deleted replies and expired tokens are expected; neither errors nor
    // interaction tokens should reach application logs.
    void Promise.resolve().then(deleteReply).catch(() => undefined);
  }, lifetimeMs);
  timer.unref();
  return timer;
}

type ActivityHook = (guildId: string, actorId: string, action: string, targetId?: string | null) => void;

/** Fetch current roles and membership rather than trusting interaction snapshots. */
export async function fetchCommandAccess(
  client: Client, guildId: string | null, userId: string,
): Promise<CommandAccess> {
  if (!guildId) return commandAccess(null);
  const guild = await client.guilds.fetch({ guild: guildId, force: true });
  const [roles, member] = await Promise.all([
    guild.roles.fetch(), guild.members.fetch({ user: userId, force: true, cache: false }),
  ]);
  return commandAccess({
    guildId: guild.id, ownerId: guild.ownerId, userId,
    memberRoleIds: [...member.roles.cache.keys()],
    roles: roles.map(role => ({
      id: role.id, name: role.name, position: role.rawPosition,
      permissions: role.permissions.bitfield.toString(), managed: role.managed,
    })), grants: [],
  });
}

export function createCommandHandler(client: Client, config: Config, addActivity: ActivityHook) {
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  function record(interaction: ChatInputCommandInteraction, action: string) {
    if (!interaction.guildId) return;
    try { addActivity(interaction.guildId, interaction.user.id, action, interaction.channelId); }
    catch { /* Activity storage failure must not expose interaction data. */ }
  }

  async function handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (stopped || interaction.commandName === 'contact' || !COMMANDS.some(command => command.name === interaction.commandName)) return;
    try {
      // The acknowledgement is the first network request, before any role fetch.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let access: CommandAccess = { inGuild: !!interaction.guildId, administrator: false };
      if (interaction.commandName !== 'ping') {
        try { access = await fetchCommandAccess(client, interaction.guildId, interaction.user.id); }
        catch {
          // Help can still show the public commands when Discord cannot verify
          // membership, while dashboard authorization always fails closed.
          if (interaction.commandName === 'dashboard') throw new Error('Access could not be verified.');
        }
      }
      if (!canUseCommand(interaction.commandName, access)) {
        await interaction.editReply({
          content: interaction.guildId
            ? 'This command requires the server owner or current Discord Administrator permission.'
            : 'Use this command inside a server.',
          allowedMentions: { parse: [] },
        });
        record(interaction, 'command.denied');
        return;
      }

      if (interaction.commandName === 'dashboard') {
        const url = new URL(config.APP_ORIGIN);
        if (config.production && url.protocol !== 'https:') throw new Error('The dashboard URL is unavailable.');
        const button = new ButtonBuilder().setStyle(ButtonStyle.Link)
          .setLabel('Open administration website').setURL(url.toString());
        await interaction.editReply({
          content: 'Sign in with Discord, then select this server. The website verifies your current access again.',
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
          allowedMentions: { parse: [] },
        });
      } else {
        await interaction.editReply({
          content: interaction.commandName === 'help' ? helpText(access) : 'Pong! The bot is responding.',
          ...(interaction.commandName === 'help' ? {
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId('inbox:contact').setLabel('Contact staff').setStyle(ButtonStyle.Secondary),
            )],
          } : {}),
          allowedMentions: { parse: [] },
        });
      }
      record(interaction, `command.${interaction.commandName}`);
    } catch {
      // Never quote Discord exceptions: they can contain private request data.
      try {
        const content = 'I could not complete that command. Please try again shortly.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content, components: [], allowedMentions: { parse: [] } });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
      } catch { /* The interaction may have expired or Discord may be offline. */ }
    } finally {
      if (!stopped && (interaction.deferred || interaction.replied)) {
        const timer = scheduleEphemeralDeletion(() => {
          timers.delete(timer);
          return interaction.deleteReply();
        });
        timers.add(timer);
      }
    }
  }

  return {
    handle,
    stop() { stopped = true; for (const timer of timers) clearTimeout(timer); timers.clear(); },
  };
}
