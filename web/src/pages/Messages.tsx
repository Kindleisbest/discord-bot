import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, ExternalLink, RefreshCw, Send } from 'lucide-react';
import { api, ApiError, errorMessage, isAborted, type ChannelResponse, type GuildDetail, type MessageDelivery } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

const BOT_MESSAGES: Record<ChannelResponse['bot']['state'], string> = {
  not_configured: 'The bot is not configured yet. Sending is unavailable until its credentials are set up.',
  connecting: 'The bot is connecting to Discord. Refresh its status before sending.',
  ready: 'The bot is connected to Discord.',
  disconnected: 'The bot is disconnected from Discord. Refresh its status before sending.',
};

export function Messages({ detail, csrfToken, onAccessError }: { detail: GuildDetail; csrfToken: string; onAccessError: (error: ApiError) => void }) {
  const [channels, setChannels] = useState<ChannelResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [channelId, setChannelId] = useState('');
  const [content, setContent] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<MessageDelivery | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sendError, setSendError] = useState('');
  const alive = useRef(true);
  const sendLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const canSend = detail.access.permissions.includes('messages.send');
  const guildId = detail.guild.id;
  const chosenChannel = channels?.channels.find(channel => channel.id === channelId);
  const ready = channels?.bot.state === 'ready';
  const locked = requestId !== null;
  const uncertain = locked && (!delivery || delivery.status === 'uncertain' || delivery.status === 'pending');

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setChannels(null); setLoadError('');
    if (!canSend) return;
    const controller = new AbortController();
    void api<ChannelResponse>(`/api/guilds/${encodeURIComponent(guildId)}/channels`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setChannels(result);
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setLoadError(errorMessage(error));
    });
    return () => controller.abort();
  }, [guildId, canSend, revision, onAccessError]);
  useEffect(() => { if (reviewed || requestId) heading.current?.focus(); }, [reviewed, requestId]);

  async function send() {
    if (sendLock.current || locked || !reviewed || !ready || !chosenChannel || !content.trim()) return;
    sendLock.current = true;
    const id = crypto.randomUUID();
    setRequestId(id); setSending(true); setSendError('');
    try {
      const result = await api<{ delivery: MessageDelivery }>(`/api/guilds/${encodeURIComponent(guildId)}/messages`, { method: 'POST', body: { channelId, content: content.trim(), requestId: id }, csrfToken });
      if (alive.current) setDelivery(result.delivery);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else {
        setSendError(errorMessage(error));
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          setDelivery({ requestId: id, status: 'failed', channelId, messageId: null, createdAt: Date.now(), error: 'The website did not accept this send request.' });
        }
      }
    } finally { if (alive.current) setSending(false); }
  }

  async function checkDelivery() {
    if (!requestId || checking || sending) return;
    setChecking(true); setSendError('');
    try {
      const result = await api<{ delivery: MessageDelivery }>(`/api/guilds/${encodeURIComponent(guildId)}/messages/${encodeURIComponent(requestId)}`);
      if (alive.current) setDelivery(result.delivery);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setSendError(error instanceof ApiError && error.status === 404 ? 'No delivery record was found. Check the Discord channel before starting another message.' : errorMessage(error));
    } finally { if (alive.current) setChecking(false); }
  }

  function newMessage() {
    if (sending || checking) return;
    setContent(''); setReviewed(false); setRequestId(null); setDelivery(null); setSendError(''); sendLock.current = false;
    setRevision(value => value + 1);
  }

  return <>
    <div className="page-heading"><h1>Send a message</h1><p>Post through the bot in {detail.guild.name}.</p></div>
    {!canSend ? <section className="empty-state"><h2>Message access is required</h2><p>Ask the server owner or an authorized higher administrator for the Send channel messages website permission.</p></section> : <>
      {loadError ? <ErrorNotice message={loadError} retry={() => setRevision(value => value + 1)} /> : channels ? <div className="composer-status"><p role="status">{BOT_MESSAGES[channels.bot.state]}</p><button className="button button-outline button-small" onClick={() => setRevision(value => value + 1)} disabled={sending || checking}><RefreshCw size={17} aria-hidden="true" />Refresh status</button></div> : <Loading>Loading available channels…</Loading>}
      {channels && channels.channels.length === 0 && !locked ? <section className="empty-state"><h2>No available text channels</h2><p>Check the bot’s channel visibility and sending permissions in Discord, then refresh.</p></section> : null}
      {(channels && channels.channels.length > 0) || locked ? <section className="message-composer" aria-labelledby="composer-title">
        <h2 id="composer-title" ref={heading} tabIndex={-1}>{locked ? 'Message delivery' : reviewed ? 'Review your message' : 'Write your message'}</h2>
        {!reviewed && !locked ? <form onSubmit={event => { event.preventDefault(); if (ready && chosenChannel && content.trim()) { setContent(content.trim()); setReviewed(true); } }}>
          <div className="field"><label htmlFor="message-channel">Discord channel</label><select id="message-channel" value={channelId} onChange={event => setChannelId(event.target.value)} required disabled={!ready}><option value="">Choose a text channel</option>{channels?.channels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></div>
          <div className="field message-content-field"><label htmlFor="message-content">Message</label><textarea id="message-content" value={content} onChange={event => setContent(event.target.value)} maxLength={2000} rows={7} required disabled={!ready} aria-describedby="message-count message-mentions" /><p className="character-count" id="message-count">{content.length.toLocaleString()} / 2,000 characters</p></div>
          <p className="supporting-note" id="message-mentions">All mentions are sent without notifications, including @everyone, roles, and individual members.</p>
          <button className="button button-primary" type="submit" disabled={!ready || !chosenChannel || !content.trim()}><Eye size={19} aria-hidden="true" />Review message</button>
        </form> : <>
          <dl className="message-recipient"><dt>Server</dt><dd>{detail.guild.name}</dd><dt>Channel</dt><dd>{chosenChannel ? `#${chosenChannel.name}` : `Channel ${channelId}`}</dd></dl>
          <h3 className="preview-label">Plain-text preview</h3><div className="message-preview">{content}</div><p className="supporting-note">Discord may format Markdown. All mentions are sent without notifications.</p>
          {!locked ? <div className="composer-actions"><button className="button button-outline" onClick={() => setReviewed(false)}><ArrowLeft size={18} aria-hidden="true" />Edit message</button><button className="button button-primary" onClick={() => void send()} disabled={!ready || !chosenChannel}><Send size={18} aria-hidden="true" />Send to #{chosenChannel?.name ?? 'channel'}</button></div> : <>
            <div className={`delivery-result ${delivery?.status === 'sent' ? 'delivered' : ''}`} role="status">
              <h3>{sending ? 'Sending your message…' : delivery?.status === 'sent' ? 'Message sent' : delivery?.status === 'failed' ? 'Message was not sent' : delivery?.status === 'pending' ? 'Delivery is pending' : 'Delivery is not confirmed'}</h3>
              <p>{sending ? 'Keep this page open while Discord processes the request.' : delivery?.status === 'sent' ? 'Discord confirmed that the bot posted this message.' : delivery?.status === 'failed' ? delivery.error ?? 'The send request failed.' : 'Check the delivery status and the Discord channel before starting another message. Sending the same text again could create a duplicate.'}</p>
              {delivery?.status === 'sent' && delivery.messageId ? <a className="delivery-link" href={`https://discord.com/channels/${encodeURIComponent(guildId)}/${encodeURIComponent(delivery.channelId)}/${encodeURIComponent(delivery.messageId)}`} target="_blank" rel="noreferrer">View message in Discord<ExternalLink size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : null}
            </div>
            {sendError ? <ErrorNotice message={sendError} /> : null}
            <div className="composer-actions">{uncertain ? <button className="button button-outline" onClick={() => void checkDelivery()} disabled={checking || sending}><RefreshCw size={18} aria-hidden="true" />{checking ? 'Checking delivery…' : 'Check delivery status'}</button> : null}<button className="button button-primary" onClick={newMessage} disabled={sending || checking}>Start a new message</button></div>
            <p className="supporting-note">Delivery checks never send another message. Leaving this page or switching servers clears this draft; it does not cancel a send already in progress.</p>
          </>}
        </>}
      </section> : null}
    </>}
  </>;
}
