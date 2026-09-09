import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage, isAborted, type GuildDetail, type GuildSummary, type ServiceStatus, type Session } from './api';

export function useSession() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const signal = controller.signal;
    void Promise.all([
      api<ServiceStatus>('/api/status', { signal }),
      api<Session>('/api/me', { signal }).catch(error => { if (error instanceof ApiError && error.status === 401) return null; throw error; }),
    ]).then(([nextStatus, nextSession]) => {
      if (!signal.aborted) { setStatus(nextStatus); setSession(nextSession); }
    }).catch(error => { if (!signal.aborted && !isAborted(error)) { setStatus(null); setSession(null); setError(errorMessage(error)); } }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return { status, session, setSession, loading, error, retry };
}

export function useGuilds(userId: string | undefined, onAccessError: (error: ApiError) => void) {
  const [result, setResult] = useState<{ userId: string; guilds: GuildSummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setResult(null); setError('');
    if (!userId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void api<{ guilds: GuildSummary[] }>('/api/guilds', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ userId, guilds: data.guilds });
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, revision, onAccessError]);
  return { guilds: result && result.userId === userId ? result.guilds : [], loading, error, retry };
}

export function useGuildDetail(guildId: string, onAccessError: (error: ApiError) => void) {
  const [result, setResult] = useState<{ id: string; data: GuildDetail } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setResult(null); setError('');
    if (!guildId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void api<GuildDetail>(`/api/guilds/${encodeURIComponent(guildId)}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) {
        if (!data.access.allowed) onAccessError(new ApiError(403, data.access.reason));
        else setResult({ id: guildId, data });
      }
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [guildId, revision, onAccessError]);
  return { detail: result?.id === guildId ? result.data : null, error, loading, refresh };
}
