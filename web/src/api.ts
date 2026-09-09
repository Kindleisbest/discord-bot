import type { Permission } from '../../shared/permissions';

export interface ServiceStatus { configured: boolean; service: string; stage: number }
export interface Session {
  user: { id: string; username: string; avatar: string | null };
  csrfToken: string;
  onboarding: { completed: boolean; step: number };
}
export interface GuildSummary { id: string; name: string; icon: string | null; isOwner: boolean }
export interface GuildDetail {
  guild: { id: string; name: string; icon: string | null; ownerId: string };
  access: { allowed: boolean; isOwner: boolean; permissions: Permission[]; highestRolePosition: number; highestRoleId: string | null; reason: string };
  roles: { id: string; name: string; position: number; permissions: string; managed?: boolean }[];
  grants: { roleId: string; permissions: Permission[] }[];
  memberRoleIds?: string[];
  editableRoleIds: string[];
}
export interface Activity { id: string; actorId: string; action: string; targetId: string | null; createdAt: number }
export interface MessageChannel { id: string; name: string; type: 0 | 5 }
export interface ChannelResponse {
  channels: MessageChannel[];
  bot: { state: 'not_configured' | 'connecting' | 'ready' | 'disconnected'; lastReadyAt: number | null };
}
export interface MessageDelivery {
  requestId: string; status: 'pending' | 'sent' | 'failed' | 'uncertain';
  channelId: string; messageId: string | null; createdAt: number; error: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; csrfToken?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.csrfToken ? { 'x-csrf-token': options.csrfToken } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    const fallback = response.status === 401 ? 'Your session has ended. Sign in again to continue.' : response.status === 403 ? 'Your access has changed. Refresh or choose another server.' : 'The request could not be completed. Please try again.';
    throw new ApiError(response.status, data?.message ?? data?.error ?? fallback);
  }
  return await response.json() as T;
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function isAborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
