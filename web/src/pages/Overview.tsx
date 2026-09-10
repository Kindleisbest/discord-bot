import { useEffect, useState } from 'react';
import { Activity as ActivityIcon, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError, errorMessage, isAborted, type Activity, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

const ACTION_LABELS: Record<string, string> = { 'permissions.updated': 'Website permissions updated', 'permissions.update': 'Website permissions updated', 'auth.login': 'Administrator signed in', 'onboarding.completed': 'Administrator tutorial completed', 'gateway.connected': 'Bot connected to Discord', 'commands.ready': 'Slash commands are ready', 'message.sent': 'Bot message sent', 'inbox.enabled': 'Staff inbox enabled', 'inbox.disabled': 'Staff inbox disabled', 'inbox.received': 'Member message received', 'inbox.replied': 'Staff reply sent', 'inbox.closed': 'Staff conversation closed', 'event.created': 'Discord event created', 'event.announced': 'Event announcement sent' };

export function Overview({ detail, onAccessError }: { detail: GuildDetail; onAccessError: (error: ApiError) => void }) {
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const allowed = detail.access.permissions.includes('activity.view');
  const guildId = detail.guild.id;
  useEffect(() => {
    setActivity(null); setError('');
    if (!allowed) return;
    const controller = new AbortController();
    void api<{ activity: Activity[] }>(`/api/guilds/${encodeURIComponent(guildId)}/activity`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setActivity(data.activity);
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [guildId, allowed, revision, onAccessError]);
  return <>
    <div className="page-heading"><h1>{detail.guild.name}</h1><p>Your server’s workspace, activity, and access.</p></div>
    <div className="access-summary"><ShieldCheck aria-hidden="true" size={24} /><p>{detail.access.isOwner ? 'You are the server owner. You have full website access.' : 'Discord Administrator verified. Your website access follows your role permissions.'}</p></div>
    <section className="activity-section" aria-labelledby="activity-title"><div className="section-heading"><h2 id="activity-title">Latest activity</h2>{allowed ? <button className="button button-outline button-small" onClick={() => setRevision(value => value + 1)} disabled={activity === null && !error}><RefreshCw size={17} aria-hidden="true" />Refresh</button> : null}</div>
      {!allowed ? <p>You do not have access to view activity. Contact your server owner.</p> : error ? <ErrorNotice message={error} retry={() => setRevision(value => value + 1)} /> : activity === null ? <Loading>Loading server activity…</Loading> : activity.length === 0 ? <div className="empty-state"><ActivityIcon size={34} aria-hidden="true" /><h3>No activity yet</h3><p>Bot connections, command setup, message deliveries, and permission changes will appear here.</p></div> : <ol className="activity-list">{activity.map(item => <li key={item.id}><div><h3>{ACTION_LABELS[item.action] ?? item.action.replace(/[._]/g, ' ')}</h3><p>Discord user <code>{item.actorId}</code>{item.targetId ? <> · Target <code>{item.targetId}</code></> : null}</p></div><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></li>)}</ol>}
    </section>
    <p className="supporting-note">Activity records actions without message text. Authorized administrators can read retained private conversations in Staff inbox. Server-channel message audit and exports are planned for a later stage.</p>
  </>;
}
