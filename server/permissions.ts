import { PERMISSIONS, type Permission } from '../shared/permissions.js';

export type DiscordRole = {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed?: boolean;
};

export type RoleGrant = { roleId: string; permissions: Permission[] };

export type GuildAccessInput = {
  guildId: string;
  ownerId: string;
  userId: string;
  memberRoleIds: string[];
  roles: DiscordRole[];
  grants: RoleGrant[];
};

export type AccessDecision = {
  allowed: boolean;
  isOwner: boolean;
  permissions: Permission[];
  highestRolePosition: number;
  highestRoleId: string | null;
  reason: string;
};

const ADMINISTRATOR = 8n;
const knownPermissions = new Set<string>(PERMISSIONS);

function denied(reason: string): AccessDecision {
  return {
    allowed: false, isOwner: false, permissions: [],
    highestRolePosition: 0, highestRoleId: null, reason,
  };
}

function highestRole(roles: DiscordRole[]): DiscordRole | undefined {
  return roles.reduce<DiscordRole | undefined>((highest, role) => {
    if (!highest || role.position > highest.position) return role;
    if (role.position !== highest.position) return highest;
    // Snowflakes are integers too large for Number. Lower IDs win a position tie.
    const lowerId = /^\d+$/.test(role.id) && /^\d+$/.test(highest.id)
      ? BigInt(role.id) < BigInt(highest.id) : role.id < highest.id;
    return lowerId ? role : highest;
  }, undefined);
}

/**
 * The caller must first authenticate the user through Discord OAuth and fetch
 * the current guild, membership, and roles from Discord for this guild. Saved
 * website grants never replace that membership and Administrator check.
 * Discord permission calculation: https://docs.discord.com/developers/topics/permissions
 */
export function resolveAccess(input: GuildAccessInput): AccessDecision {
  if (!input.guildId || !input.ownerId || !input.userId) {
    return denied('The server and authenticated Discord identity are required.');
  }

  const isOwner = input.userId === input.ownerId;
  if (isOwner) {
    const highest = highestRole(input.roles.filter(role =>
      role.id === input.guildId || input.memberRoleIds.includes(role.id)));
    return {
      allowed: true, isOwner: true, permissions: [...PERMISSIONS],
      highestRolePosition: highest?.position ?? 0,
      highestRoleId: highest?.id ?? null,
      reason: 'The server owner always has full website access.',
    };
  }

  const rolesById = new Map<string, DiscordRole>();
  for (const role of input.roles) {
    if (!role.id || rolesById.has(role.id)
      || !Number.isSafeInteger(role.position) || role.position < 0
      || !/^\d+$/.test(role.permissions)) {
      return denied('Current Discord role data is invalid; refresh access.');
    }
    rolesById.set(role.id, role);
  }

  // @everyone is identified by THIS guild's ID, never by its editable name.
  if (!rolesById.has(input.guildId)) {
    return denied('Current role data does not belong to this server.');
  }
  const memberRoleIds = new Set([input.guildId, ...input.memberRoleIds]);
  if ([...memberRoleIds].some(id => !rolesById.has(id))) {
    return denied('Current Discord membership and role data do not match.');
  }

  const memberRoles = [...memberRoleIds].map(id => rolesById.get(id)!);
  const discordPermissions = memberRoles.reduce((bits, role) =>
    bits | BigInt(role.permissions), 0n);
  if ((discordPermissions & ADMINISTRATOR) !== ADMINISTRATOR) {
    return denied('Discord Administrator permission is required for website access.');
  }

  const granted = new Set<Permission>(['activity.view']);
  for (const grant of input.grants) {
    if (!memberRoleIds.has(grant.roleId)) continue;
    for (const permission of grant.permissions) {
      if (knownPermissions.has(permission)) granted.add(permission);
    }
  }
  const highest = highestRole(memberRoles);
  return {
    allowed: true, isOwner: false,
    permissions: PERMISSIONS.filter(permission => granted.has(permission)),
    highestRolePosition: highest?.position ?? 0,
    highestRoleId: highest?.id ?? null,
    reason: 'Discord Administrator verified; website permissions come from role grants.',
  };
}

/** Validate a full replacement of one role's website grant before saving it. */
export function assertGrantChange(
  input: GuildAccessInput,
  targetRoleId: string,
  requestedPermissions: Permission[],
): void {
  const access = resolveAccess(input);
  if (!access.allowed) throw new Error(access.reason);
  if (!Array.isArray(requestedPermissions)
    || requestedPermissions.some(permission => !knownPermissions.has(permission))) {
    throw new Error('The requested website permission is not recognized.');
  }
  const targets = input.roles.filter(role => role.id === targetRoleId);
  if (targets.length !== 1) {
    throw new Error('The target role must exist in the current server.');
  }
  const target = targets[0];

  // The owner exception applies to every real role, including their own,
  // @everyone, and integration roles. It cannot change the OAuth/admin gate.
  if (access.isOwner) return;
  if (!access.permissions.includes('permissions.manage')) {
    throw new Error('Managing website permissions must first be delegated by the server owner.');
  }
  if (targetRoleId === input.guildId || input.memberRoleIds.includes(targetRoleId)) {
    throw new Error('You cannot change website permissions for @everyone or a role you hold.');
  }
  if (target.managed) {
    throw new Error('Only the server owner can change website permissions for integration roles.');
  }
  // Conservatively deny ALL equal-position edits, even when Discord would
  // break the tie by snowflake. Reorder roles in Discord to make rank explicit.
  if (target.position >= access.highestRolePosition) {
    throw new Error('You can manage only roles strictly below your highest Discord role.');
  }

  const actorPermissions = new Set(access.permissions);
  if (requestedPermissions.some(permission => !actorPermissions.has(permission))) {
    throw new Error('You can grant only website permissions you already have.');
  }
  // Protect owner/senior grants from replacement or deletion by a less
  // privileged manager. Include every stored entry if duplicate grants exist.
  const existing = input.grants.filter(grant => grant.roleId === targetRoleId);
  if (existing.some(grant => grant.permissions.some(permission =>
    !actorPermissions.has(permission)))) {
    throw new Error('This role has protected permissions; a more privileged administrator must edit it.');
  }
}
