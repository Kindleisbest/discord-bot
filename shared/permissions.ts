export const PERMISSIONS = [
  'activity.view', 'messages.send', 'inbox.read', 'inbox.reply',
  'audit.read', 'audit.export', 'events.manage', 'tutorial.manage',
  'instagram.manage', 'leveling.view', 'leveling.adjust', 'leveling.manage',
  'settings.manage', 'permissions.manage'
] as const;
export type Permission = typeof PERMISSIONS[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  'activity.view': 'View activity', 'messages.send': 'Send channel messages',
  'inbox.read': 'Read staff inbox', 'inbox.reply': 'Reply to members',
  'audit.read': 'Read message audit', 'audit.export': 'Export message audit',
  'events.manage': 'Manage events', 'tutorial.manage': 'Edit member tutorial',
  'instagram.manage': 'Manage Instagram',
  'leveling.view': 'View leveling records', 'leveling.adjust': 'Adjust member XP',
  'leveling.manage': 'Manage leveling settings and rewards',
  'settings.manage': 'Manage settings',
  'permissions.manage': 'Manage lower roles'
};
