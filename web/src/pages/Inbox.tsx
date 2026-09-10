import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Eye, ExternalLink, RefreshCw, Send } from 'lucide-react';
import type { InboxMessage, InboxTicket } from '../../../shared/inbox';
import { api, ApiError, errorMessage, isAborted, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

type InboxPage = { settings: { enabled: boolean }; tickets: InboxTicket[]; nextOffset: number | null };
type ThreadPage = { ticket: InboxTicket; messages: InboxMessage[]; nextBefore: number | null };
type AccessErrorHandler = (error: ApiError) => void;
const date = (value: number) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const threadPath = (guildId: string, ticketId: string) => `/api/guilds/${encodeURIComponent(guildId)}/inbox/${encodeURIComponent(ticketId)}`;
function accessError(error: unknown, handler: AccessErrorHandler) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { handler(error); return true; }
  return false;
}
function mergeMessages(first: InboxMessage[], second: InboxMessage[]) {
  return [...new Map([...first, ...second].map(message => [message.id, message])).values()].sort((a, b) => a.seq - b.seq);
}
function attachmentHref(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function Inbox({ detail, csrfToken, onAccessError }: { detail: GuildDetail; csrfToken: string; onAccessError: AccessErrorHandler }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<InboxPage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedTicket, setSelectedTicket] = useState('');
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const alive = useRef(true);
  const canRead = detail.access.permissions.includes('inbox.read');
  const canReply = canRead && detail.access.permissions.includes('inbox.reply');
  const canManage = detail.access.permissions.includes('settings.manage');
  const guildId = detail.guild.id;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setError('');
    if (!canRead && !canManage) return;
    const controller = new AbortController();
    void api<InboxPage>(`/api/guilds/${encodeURIComponent(guildId)}/inbox?status=${status}&offset=${offset}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setPage(data); setEnabledDraft(data.settings.enabled); }
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (!accessError(error, onAccessError)) setError(errorMessage(error));
    });
    return () => controller.abort();
  }, [guildId, status, offset, revision, canRead, canManage, onAccessError]);

  async function saveSettings() {
    if (saveLock.current || !page) return;
    saveLock.current = true; setSaving(true); setError(''); setNotice('');
    try {
      await api(`/api/guilds/${encodeURIComponent(guildId)}/inbox/settings`, { method: 'PUT', body: { enabled: enabledDraft }, csrfToken });
      if (alive.current) { setNotice(`Staff inbox ${enabledDraft ? 'enabled' : 'disabled'}.`); setSelectedTicket(''); setRevision(value => value + 1); }
    } catch (error) { if (alive.current && !accessError(error, onAccessError)) setError(errorMessage(error)); }
    finally { saveLock.current = false; if (alive.current) setSaving(false); }
  }
  function changeList(nextStatus: 'open' | 'closed', nextOffset: number) { setSelectedTicket(''); setPage(null); setStatus(nextStatus); setOffset(nextOffset); setNotice(''); }

  return <>
    <div className="page-heading"><h1>Staff inbox</h1><p>Private member conversations for {detail.guild.name}.</p></div>
    {notice ? <p className="success-notice" role="status">{notice}</p> : null}
    {!canRead && !canManage ? <section className="empty-state"><h2>Inbox access is required</h2><p>Ask the server owner or an authorized higher administrator for Read staff inbox access.</p></section> : <>
      {error ? <ErrorNotice message={error} retry={() => setRevision(value => value + 1)} /> : null}
      {!page && !error ? <Loading>Loading the staff inbox…</Loading> : null}
      {page ? <>
        <section className="inbox-settings" aria-labelledby="inbox-settings-heading"><h2 id="inbox-settings-heading">Member contact</h2><p>Inbox messages are retained for 90 days. Attachments are stored as links, not downloaded files; the links may expire. This inbox does not archive messages from server channels.</p>
          {canManage ? <form onSubmit={event => { event.preventDefault(); void saveSettings(); }}><label className="checkbox-row"><input type="checkbox" checked={enabledDraft} disabled={saving} onChange={event => setEnabledDraft(event.target.checked)} /><span>Enable the staff inbox for this server</span></label><p className="supporting-note">When enabled, members can contact this server’s staff through the bot’s direct messages. Disabling intake keeps retained conversations available to authorized staff.</p><button className="button button-outline button-small" type="submit" disabled={saving || enabledDraft === page.settings.enabled}>{saving ? 'Saving…' : 'Save inbox setting'}</button></form> : <p className="supporting-note">Member contact is {page.settings.enabled ? 'enabled' : 'disabled'}. A server settings administrator can change this.</p>}
        </section>
        {!canRead ? <p className="supporting-note">You can manage this inbox setting, but Read staff inbox permission is required to view conversations.</p> : <div className="inbox-workspace">
          <section className="ticket-browser" aria-labelledby="ticket-list-heading"><div className="section-heading"><h2 id="ticket-list-heading">Conversations</h2><button className="icon-button" aria-label="Refresh conversations" title="Refresh conversations" onClick={() => setRevision(value => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button></div>
            <div className="field"><label htmlFor="ticket-status">Conversation status</label><select id="ticket-status" value={status} onChange={event => changeList(event.target.value as 'open' | 'closed', 0)}><option value="open">Open</option><option value="closed">Closed</option></select></div>
            {page.tickets.length ? <ul className="ticket-list">{page.tickets.map(ticket => <li key={ticket.id}><button className={`ticket-button ${selectedTicket === ticket.id ? 'active' : ''}`} aria-current={selectedTicket === ticket.id ? 'true' : undefined} onClick={() => setSelectedTicket(ticket.id)}><span className="ticket-member">Member {ticket.memberId}</span><span>{ticket.status === 'open' ? 'Open' : 'Closed'} · Updated {date(ticket.updatedAt)}</span></button></li>)}</ul> : <p className="supporting-note">No {status} conversations on this page.</p>}
            <div className="ticket-pagination"><button className="button button-outline button-small" disabled={offset === 0} onClick={() => changeList(status, Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}</span><button className="button button-outline button-small" disabled={page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) changeList(status, page.nextOffset); }}>Next</button></div>
          </section>
          {selectedTicket ? <InboxThread key={`${guildId}:${selectedTicket}`} guildId={guildId} ticketId={selectedTicket} csrfToken={csrfToken} canReply={canReply} enabled={page.settings.enabled} onAccessError={onAccessError} onClosed={() => { setSelectedTicket(''); setNotice('Conversation closed.'); setRevision(value => value + 1); }} /> : <section className="thread-empty"><h2>Choose a conversation</h2><p>Select a member to read the retained conversation.</p></section>}
        </div>}
      </> : null}
    </>}
  </>;
}

function InboxThread({ guildId, ticketId, csrfToken, canReply, enabled, onAccessError, onClosed }: { guildId: string; ticketId: string; csrfToken: string; canReply: boolean; enabled: boolean; onAccessError: AccessErrorHandler; onClosed: () => void }) {
  const [thread, setThread] = useState<ThreadPage | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const alive = useRef(true);
  const closeLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const base = threadPath(guildId, ticketId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void api<ThreadPage>(base, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setThread({ ...data, messages: mergeMessages([], data.messages) }); }).catch(error => {
      if (!controller.signal.aborted && !isAborted(error) && !accessError(error, onAccessError)) setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, revision, onAccessError]);
  const hasThread = thread !== null;
  useEffect(() => { if (hasThread) heading.current?.focus(); }, [hasThread]);

  async function older() {
    if (!thread || thread.nextBefore === null || olderLoading || loading) return;
    setOlderLoading(true); setError('');
    try {
      const data = await api<ThreadPage>(`${base}?before=${thread.nextBefore}`);
      if (alive.current) setThread(current => current ? { ...current, ticket: data.ticket, messages: mergeMessages(data.messages, current.messages), nextBefore: data.nextBefore } : current);
    } catch (error) { if (alive.current && !accessError(error, onAccessError)) setError(errorMessage(error)); }
    finally { if (alive.current) setOlderLoading(false); }
  }
  async function close() {
    if (closeLock.current || replyBusy) return;
    closeLock.current = true; setClosing(true); setError('');
    try { await api(`${base}/close`, { method: 'POST', body: {}, csrfToken }); if (alive.current) onClosed(); }
    catch (error) { if (alive.current && !accessError(error, onAccessError)) setError(errorMessage(error)); }
    finally { closeLock.current = false; if (alive.current) setClosing(false); }
  }

  return <section className="inbox-thread" aria-labelledby="thread-title">
    {error ? <ErrorNotice message={error} retry={() => setRevision(value => value + 1)} /> : null}
    {loading ? <Loading>Loading conversation…</Loading> : null}
    {thread ? <>
      <div className="section-heading"><div><h2 id="thread-title" tabIndex={-1} ref={heading}>Member {thread.ticket.memberId}</h2><p className="thread-meta">{thread.ticket.status === 'open' ? 'Open conversation' : 'Closed conversation'}</p></div><button className="icon-button" aria-label="Refresh conversation messages" title="Refresh conversation messages" disabled={loading || olderLoading || replyBusy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={18} aria-hidden="true" /></button></div>
      {thread.nextBefore !== null ? <button className="button button-outline button-small" onClick={() => void older()} disabled={olderLoading || loading}>{olderLoading ? 'Loading earlier messages…' : 'Load older messages'}</button> : null}
      {thread.messages.length ? <ol className="inbox-messages">{thread.messages.map(message => <li key={message.id} className={`inbox-message ${message.direction}`}><div className="inbox-message-meta"><strong>{message.direction === 'incoming' ? 'Member' : 'Staff reply'} · {message.actorId}</strong><span>{message.status}</span><time dateTime={new Date(message.createdAt).toISOString()}>{date(message.createdAt)}</time></div>{message.content ? <p className="inbox-message-text">{message.content}</p> : null}{message.attachments.length ? <ul className="inbox-attachments">{message.attachments.map(attachment => { const href = attachmentHref(attachment.url); return <li key={attachment.id}>{href ? <a href={href} target="_blank" rel="noreferrer noopener">{attachment.name}<ExternalLink size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : <span>{attachment.name} · Link unavailable</span>}<span>Attachment link may expire</span></li>; })}</ul> : null}</li>)}</ol> : <p className="supporting-note">There are no retained messages in this conversation.</p>}
      {canReply && thread.ticket.status === 'open' ? <><InboxReply key={ticketId} base={base} csrfToken={csrfToken} enabled={enabled} memberId={thread.ticket.memberId} onAccessError={onAccessError} onBusyChange={setReplyBusy} onMessage={message => setThread(current => current ? { ...current, messages: mergeMessages(current.messages, [message]) } : current)} />
        <div className="close-conversation">{confirmClose ? <><p id="close-explanation">Close this conversation? It will remain available under Closed until its retained content expires.</p><div className="composer-actions"><button className="button button-outline button-small" disabled={closing} onClick={() => setConfirmClose(false)}>Keep open</button><button className="button button-outline button-small" aria-describedby="close-explanation" disabled={closing || replyBusy} onClick={() => void close()}>{closing ? 'Closing…' : 'Confirm close'}</button></div></> : <button className="text-button" disabled={replyBusy} onClick={() => setConfirmClose(true)}>Close conversation</button>}</div>
      </> : <p className="supporting-note">{thread.ticket.status === 'closed' ? 'This conversation is closed.' : 'You have read-only access. Reply to members permission is required to reply or close a conversation.'}</p>}
    </> : null}
  </section>;
}

function InboxReply({ base, csrfToken, enabled, memberId, onAccessError, onMessage, onBusyChange }: { base: string; csrfToken: string; enabled: boolean; memberId: string; onAccessError: AccessErrorHandler; onMessage: (message: InboxMessage) => void; onBusyChange: (value: boolean) => void }) {
  const [content, setContent] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState<InboxMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState(false);
  const alive = useRef(true);
  const sendLock = useRef(false);
  const checkingLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const uncertain = requestId !== null && !rejected && (!message || message.status === 'pending' || message.status === 'uncertain');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (reviewed) heading.current?.focus(); }, [reviewed]);
  useEffect(() => { onBusyChange(busy || uncertain); }, [busy, uncertain, onBusyChange]);

  async function send() {
    if (sendLock.current || requestId || !enabled || !reviewed || !content.trim()) return;
    sendLock.current = true;
    const id = crypto.randomUUID(); setRequestId(id); setBusy(true); setError('');
    try {
      const data = await api<{ message: InboxMessage }>(`${base}/replies`, { method: 'POST', body: { content: content.trim(), requestId: id }, csrfToken });
      if (alive.current) { setMessage(data.message); onMessage(data.message); }
    } catch (error) {
      if (alive.current && !accessError(error, onAccessError)) {
        setError(errorMessage(error));
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) setRejected(true);
      }
    } finally { if (alive.current) setBusy(false); }
  }
  async function check() {
    if (!requestId || busy || checkingLock.current) return;
    checkingLock.current = true; setBusy(true); setError('');
    try {
      const data = await api<{ message: InboxMessage }>(`${base}/replies/${encodeURIComponent(requestId)}`);
      if (alive.current) { setMessage(data.message); onMessage(data.message); }
    } catch (error) { if (alive.current && !accessError(error, onAccessError)) setError(error instanceof ApiError && error.status === 404 ? 'No delivery record was found. Check the conversation before writing the same reply again.' : errorMessage(error)); }
    finally { checkingLock.current = false; if (alive.current) setBusy(false); }
  }
  function startNew() { if (busy) return; setContent(''); setReviewed(false); setRequestId(null); setMessage(null); setError(''); setRejected(false); sendLock.current = false; }

  return <section className="inbox-reply" aria-labelledby="reply-heading"><h3 id="reply-heading" ref={heading} tabIndex={-1}>{requestId ? 'Reply delivery' : reviewed ? 'Review staff reply' : 'Reply to this member'}</h3>
    {!enabled ? <p className="supporting-note">The staff inbox is disabled. New replies are unavailable until a settings administrator enables it; retained messages and delivery checks remain available.</p> : null}
    {!reviewed ? <form onSubmit={event => { event.preventDefault(); if (enabled && content.trim()) { setContent(content.trim()); setReviewed(true); } }}><div className="field message-content-field"><label htmlFor="inbox-reply-content">Your reply</label><textarea id="inbox-reply-content" value={content} disabled={!enabled} onChange={event => setContent(event.target.value)} maxLength={2000} rows={5} aria-describedby="inbox-reply-count" required /><p className="character-count" id="inbox-reply-count">{content.length.toLocaleString()} / 2,000 characters</p></div><button type="submit" className="button button-primary" disabled={!enabled || !content.trim()}><Eye size={18} aria-hidden="true" />Review reply</button></form> : <>
      <p className="supporting-note">Direct message to member {memberId}. Plain-text preview:</p><div className="message-preview">{content}</div>
      {!requestId ? <div className="composer-actions"><button className="button button-outline" onClick={() => setReviewed(false)}><ArrowLeft size={18} aria-hidden="true" />Edit reply</button><button className="button button-primary" disabled={!enabled} onClick={() => void send()}><Send size={18} aria-hidden="true" />Send reply</button></div> : <>
        <div className={`delivery-result ${message?.status === 'sent' ? 'delivered' : ''}`} role="status"><h3>{busy ? 'Checking reply delivery…' : message?.status === 'sent' ? 'Reply sent' : rejected || message?.status === 'failed' ? 'Reply was not sent' : message?.status === 'pending' ? 'Reply delivery is pending' : 'Reply delivery is not confirmed'}</h3><p>{message?.status === 'sent' ? 'Discord confirmed delivery of this staff reply.' : rejected || message?.status === 'failed' ? 'The send request could not be completed. Start a new reply when you are ready.' : 'Check delivery and the conversation before starting another reply. Sending the same text again could create a duplicate.'}</p></div>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="composer-actions">{uncertain ? <button className="button button-outline" disabled={busy} onClick={() => void check()}><RefreshCw size={18} aria-hidden="true" />Check delivery status</button> : null}<button className="button button-primary" disabled={busy} onClick={startNew}><Check size={18} aria-hidden="true" />Start a new reply</button></div>
        <p className="supporting-note">Delivery checks never resend a reply. Leaving this conversation clears the draft but does not cancel a send already in progress.</p>
      </>}
    </>}
  </section>;
}
