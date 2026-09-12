import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Save } from 'lucide-react';
import type { InstagramDeliverySummary, InstagramOptions, InstagramRuntime, InstagramSettings, InstagramSettingsInput } from '../../../shared/instagram';
import { api, ApiError, errorMessage, isAborted, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

function editable(settings: InstagramSettings): InstagramSettingsInput {
  return { sourceChannelIds: [...settings.sourceChannelIds], destinationChannelId: settings.destinationChannelId, embedTitle: settings.embedTitle, embedDescription: settings.embedDescription, embedColor: settings.embedColor, expectedRevision: settings.revision, enabled: settings.enabled };
}
const deliveryLabels = { pending: 'Pending', sent: 'Sent', failed: 'Failed', uncertain: 'Uncertain' } as const;

export function Instagram({ detail, csrfToken, onAccessError, onUnsavedChange }: {
  detail: GuildDetail; csrfToken: string; onAccessError: (error: ApiError) => void; onUnsavedChange: (unsaved: boolean) => void;
}) {
  const canManage = detail.access.permissions.includes('instagram.manage');
  const canSave = canManage && detail.access.permissions.includes('messages.send');
  const [saved, setSaved] = useState<InstagramSettings | null>(null);
  const [draft, setDraft] = useState<InstagramSettingsInput | null>(null);
  const [runtime, setRuntime] = useState<InstagramRuntime | null>(null);
  const [options, setOptions] = useState<InstagramOptions | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [channelsLoading, setChannelsLoading] = useState(canManage);
  const [channelError, setChannelError] = useState('');
  const [channelVersion, setChannelVersion] = useState(0);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState(false);
  const [deliveries, setDeliveries] = useState<InstagramDeliverySummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(canManage);
  const [historyError, setHistoryError] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const saveRequest = useRef<AbortController | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const enabledInput = useRef<HTMLInputElement>(null);
  const endpoint = `/api/guilds/${encodeURIComponent(detail.guild.id)}/instagram`;
  const dirty = Boolean(saved && draft && JSON.stringify(editable(saved)) !== JSON.stringify(draft));
  const unavailableSources = draft?.sourceChannelIds.filter(id => !options?.sourceChannels.some(channel => channel.id === id)) ?? [];
  const unavailableDestination = Boolean(draft?.destinationChannelId && !options?.destinationChannels.some(channel => channel.id === draft.destinationChannelId));
  const titleInvalid = Boolean(draft && (!draft.embedTitle.trim() || draft.embedTitle.trim().length > 100));
  const colorInvalid = Boolean(draft && !/^#[0-9a-f]{6}$/i.test(draft.embedColor));
  const runtimeReady = Boolean(runtime?.available && runtime.botReady);
  const savedStatus = !saved ? '' : !saved.enabled ? 'Automatic posting is disabled.' : !runtime?.available ? 'Enabled in saved settings · posting unavailable on this host.' : !runtime.botReady ? 'Enabled in saved settings · bot offline.' : 'Automatic posting is enabled.';

  useEffect(() => {
    onUnsavedChange(dirty || saving);
    return () => onUnsavedChange(false);
  }, [dirty, saving, onUnsavedChange]);
  useEffect(() => {
    if (!dirty && !saving) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty, saving]);
  useEffect(() => () => saveRequest.current?.abort(), [endpoint]);
  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    void api<{ settings: InstagramSettings; runtime: InstagramRuntime }>(endpoint, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setSaved(result.settings); setDraft(editable(result.settings)); setRuntime(result.runtime);
      setConflict(false); setValidation(false);
      if (loadVersion > 0) setNotice('Saved settings and posting status reloaded.');
    }).catch(requestError => {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else setError(errorMessage(requestError));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, canManage, loadVersion, onAccessError]);
  useEffect(() => {
    if (!canManage) { setChannelsLoading(false); return; }
    const controller = new AbortController();
    setChannelsLoading(true); setChannelError(''); setOptions(null);
    void api<{ options: InstagramOptions }>(`${endpoint}/options`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setOptions(result.options);
    }).catch(requestError => {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else setChannelError(errorMessage(requestError));
    }).finally(() => { if (!controller.signal.aborted) setChannelsLoading(false); });
    return () => controller.abort();
  }, [endpoint, canManage, loadVersion, channelVersion, onAccessError]);
  useEffect(() => {
    if (!canManage) { setHistoryLoading(false); return; }
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError('');
    void api<{ deliveries: InstagramDeliverySummary[] }>(`${endpoint}/deliveries`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setDeliveries(result.deliveries);
    }).catch(requestError => {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else setHistoryError(errorMessage(requestError));
    }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [endpoint, canManage, historyVersion, onAccessError]);

  function reload() {
    if (loading || saving || (dirty && !window.confirm('Discard your unsaved changes and reload the saved Instagram settings?'))) return;
    setNotice(''); setLoadVersion(version => version + 1);
  }
  function update(change: Partial<InstagramSettingsInput>) { setDraft(current => current ? { ...current, ...change } : current); setNotice(''); }
  function channelLabel(id: string) {
    const channel = options?.sourceChannels.find(item => item.id === id) ?? options?.destinationChannels.find(item => item.id === id);
    return channel ? `#${channel.name} · ${id}` : `Channel ${id}`;
  }
  async function save() {
    if (!draft || !canSave || loading || saving || conflict) return;
    setValidation(true); setError(''); setNotice('');
    if (titleInvalid) { setError('Enter a title of 1 to 100 characters.'); titleInput.current?.focus(); return; }
    if (colorInvalid) { setError('Enter a color as # followed by six hexadecimal digits, such as #5865F2.'); colorInput.current?.focus(); return; }
    if (draft.embedDescription.trim().length > 2000) { setError('Keep the description to 2,000 characters or fewer.'); return; }
    if (draft.sourceChannelIds.length > 25) { setError('Choose at most 25 source channels.'); return; }
    if (draft.destinationChannelId && draft.sourceChannelIds.includes(draft.destinationChannelId)) { setError('The destination must be different from every source channel.'); return; }
    if (draft.enabled) {
      if (!runtimeReady) { setError('Posting cannot be enabled while it is unavailable on this host or the bot is offline. You can still disable posting and save.'); enabledInput.current?.focus(); return; }
      if (!draft.sourceChannelIds.length || !draft.destinationChannelId) { setError('Choose at least one source channel and a different destination before enabling posting.'); return; }
      if (channelsLoading || !options) { setError('Reload the channel list before enabling posting. You can still disable posting and save.'); return; }
      if (unavailableSources.length || unavailableDestination) { setError('Remove unavailable source channels and clear or replace the unavailable destination before enabling posting. You can still disable posting and save.'); return; }
    }
    const controller = new AbortController(); saveRequest.current = controller; setSaving(true);
    try {
      const result = await api<{ settings: InstagramSettings }>(endpoint, { method: 'PUT', csrfToken, signal: controller.signal, body: { ...draft, enabled: Boolean(draft.enabled), embedTitle: draft.embedTitle.trim(), embedDescription: draft.embedDescription.trim(), embedColor: draft.embedColor.toUpperCase() } });
      if (controller.signal.aborted) return;
      setSaved(result.settings); setDraft(editable(result.settings)); setValidation(false);
      setNotice(result.settings.enabled ? 'Instagram settings saved with automatic posting enabled. Only new eligible links will be processed.' : 'Instagram settings saved. Automatic posting is disabled.');
    } catch (requestError) {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else if (requestError instanceof ApiError && requestError.status === 409) setConflict(true);
      else setError(errorMessage(requestError));
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      if (saveRequest.current === controller) saveRequest.current = null;
    }
  }

  return <>
    <div className="page-heading"><h1>Instagram</h1><p>Manage Instagram link posting for {detail.guild.name}.</p></div>
    {!canManage ? <section className="empty-state"><h2>Instagram settings need permission</h2><p>Ask your server owner or an authorized administrator for the Manage Instagram website permission.</p></section> : <>
      {saved ? <p className="access-summary" role="status"><strong>{savedStatus}</strong></p> : null}
      <p className="tutorial-intro instagram-intro">When enabled, new Instagram links in selected text or announcement channels are posted as link embeds in the destination. Existing messages are not scanned. The bot does not fetch Instagram images, videos, or captions.</p>
      {!canSave ? <p className="supporting-note">You can view settings and delivery history. Saving also requires the Send channel messages website permission.</p> : null}
      {runtime && !runtime.available ? <p className="supporting-note">To make posting available, the host must set <code>INSTAGRAM_LINKS_ENABLED=true</code>, enable <strong>Message Content Intent</strong> on the application’s Bot page in the Discord Developer Portal, and restart the service. You can save a disabled setup or disable previously enabled posting now.</p> : runtime && !runtime.botReady ? <p className="supporting-note">The bot is offline. Reconnect the bot, then reload settings before enabling posting. Saved settings and delivery history remain available, and you can disable posting now.</p> : null}
      {loading && !draft ? <Loading>Loading Instagram settings…</Loading> : null}
      {error ? <ErrorNotice message={error} retry={!draft ? reload : undefined} /> : null}
      {notice ? <p className="success-notice" role="status">{notice}</p> : null}
      {draft ? <section className="member-tutorial-editor" aria-label="Instagram settings" aria-busy={loading || saving}>
        <div className="tutorial-summary"><p>{saved?.updatedAt ? 'Saved settings' : 'New setup'}{dirty ? ' · Unsaved changes' : ''}</p><button className="button button-outline button-small" onClick={reload} disabled={loading || saving}>{loading ? 'Reloading…' : 'Reload settings and channels'}</button></div>
        {conflict ? <div className="tutorial-conflict" role="alert"><h2>Settings changed in another session</h2><p>Your draft is still here. Copy anything you want to keep, then reload the current saved settings before saving again.</p><button className="button button-outline" disabled={loading || saving} onClick={reload}>Reload current saved settings</button></div> : null}
        {channelError ? <ErrorNotice message={`Channel list unavailable. ${channelError} Saved channel IDs are preserved; you can still disable posting and save.`} retry={() => setChannelVersion(version => version + 1)} /> : null}
        {channelsLoading ? <Loading>Loading available channels…</Loading> : null}
        <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="tutorial-fields" disabled={!canSave || loading || saving}>
            <legend className="sr-only">Posting, channels, and embed appearance</legend>
            <label className="checkbox-row tutorial-publish"><input ref={enabledInput} type="checkbox" checked={Boolean(draft.enabled)} disabled={!draft.enabled && !runtimeReady} aria-describedby="instagram-enabled-help" onChange={event => update({ enabled: event.target.checked })} /><span>Enable automatic Instagram link posting</span></label>
            <p className="event-field-help" id="instagram-enabled-help">This choice takes effect when you save. Every delivery checks channel permissions again.{saved && Boolean(draft.enabled) !== saved.enabled ? ` Unsaved change: posting will be ${draft.enabled ? 'enabled' : 'disabled'} when you save.` : ''}</p>
            <fieldset className="permission-options instagram-sources" aria-describedby="instagram-source-help"><legend>Source channels ({draft.sourceChannelIds.length} / 25)</legend>
              {options?.sourceChannels.map(channel => <label className="checkbox-row" key={channel.id}><input type="checkbox" checked={draft.sourceChannelIds.includes(channel.id)} disabled={!draft.sourceChannelIds.includes(channel.id) && (draft.sourceChannelIds.length >= 25 || draft.destinationChannelId === channel.id)} onChange={event => update({ sourceChannelIds: event.target.checked ? [...draft.sourceChannelIds, channel.id] : draft.sourceChannelIds.filter(id => id !== channel.id) })} /><span>#{channel.name} <span className="instagram-channel-id">{channel.id}</span></span></label>)}
              {unavailableSources.map(id => <label className="checkbox-row" key={id}><input type="checkbox" checked onChange={() => update({ sourceChannelIds: draft.sourceChannelIds.filter(value => value !== id) })} /><span>{options ? 'Unavailable channel' : 'Channel not verified'} · {id} — uncheck to remove</span></label>)}
              {options && !options.sourceChannels.length && !unavailableSources.length ? <p>No source channels are available.</p> : null}
            </fieldset>
            <p className="event-field-help" id="instagram-source-help">Select up to 25 text or announcement channels. Posting requires at least one source and a destination. The bot needs View Channel and Read Message History in every source. Disabled setups can be saved with incomplete or unavailable channels.</p>
            <div className="field"><label htmlFor="instagram-destination">Destination channel</label><select id="instagram-destination" value={draft.destinationChannelId ?? ''} aria-describedby="instagram-destination-help" onChange={event => update({ destinationChannelId: event.target.value || null })}><option value="">No destination selected</option>{unavailableDestination ? <option value={draft.destinationChannelId!}>{options ? 'Unavailable channel' : 'Channel not verified'} · {draft.destinationChannelId}</option> : null}{options?.destinationChannels.map(channel => <option key={channel.id} value={channel.id} disabled={draft.sourceChannelIds.includes(channel.id)}>#{channel.name} · {channel.id}{draft.sourceChannelIds.includes(channel.id) ? ' · Selected as source' : ''}</option>)}</select><p className="event-field-help" id="instagram-destination-help">Choose a different channel from your sources. The bot needs View Channel, Send Messages, and Embed Links in the destination.{unavailableDestination ? ' This destination must be verified or replaced before posting can be enabled.' : ''}</p></div>
            <p className="supporting-note">Source and destination must have matching View Channel permission overrides, with an exception for the bot’s own member override. This conservative audience check may reject channels that appear to have the same members. Review the channel audience in Discord before enabling posting.</p>
            <div className="field"><label htmlFor="instagram-title">Embed title</label><input id="instagram-title" ref={titleInput} value={draft.embedTitle} maxLength={100} required aria-invalid={validation && titleInvalid || undefined} aria-describedby="instagram-title-help" onChange={event => update({ embedTitle: event.target.value })} /><p className="event-field-help" id="instagram-title-help">Required, up to 100 characters.</p></div>
            <div className="field message-content-field"><label htmlFor="instagram-description">Embed description (optional)</label><textarea id="instagram-description" value={draft.embedDescription} rows={4} maxLength={2000} aria-describedby="instagram-description-help" onChange={event => update({ embedDescription: event.target.value })} /><p className="event-field-help" id="instagram-description-help">{draft.embedDescription.length.toLocaleString()} / 2,000 characters. Title and description are static text; placeholders are not replaced.</p></div>
            <div className="field"><label htmlFor="instagram-color">Embed color</label><input id="instagram-color" ref={colorInput} value={draft.embedColor} maxLength={7} spellCheck={false} required aria-invalid={validation && colorInvalid || undefined} aria-describedby="instagram-color-help" onChange={event => update({ embedColor: event.target.value })} /><p className="event-field-help" id="instagram-color-help">Use a six-digit hex color, such as #5865F2.</p></div>
          </fieldset>
          <section className="tutorial-preview" aria-labelledby="instagram-preview-title"><h2 id="instagram-preview-title">Text preview</h2><div className="message-preview" style={{ borderLeft: `5px solid ${colorInvalid ? '#5865F2' : draft.embedColor}` }}><h3>{draft.embedTitle.trim() || 'Embed title'}</h3>{draft.embedDescription.trim() ? <p>{draft.embedDescription.trim()}</p> : null}</div><p className="event-field-help">Previewing does not send a message. Each delivered embed links to the detected Instagram URL.</p></section>
          <div className="composer-actions"><button className="button button-primary" type="submit" disabled={!dirty || !canSave || loading || saving || conflict}><Save size={18} aria-hidden="true" />{saving ? 'Saving settings…' : 'Save settings'}</button></div>
        </form>
      </section> : null}
      <section className="instagram-history" aria-labelledby="instagram-history-title" aria-busy={historyLoading}>
        <div className="section-heading"><h2 id="instagram-history-title">Delivery history</h2><button className="button button-outline button-small" disabled={historyLoading} onClick={() => setHistoryVersion(version => version + 1)}><RefreshCw size={16} aria-hidden="true" />{historyLoading ? 'Refreshing…' : 'Refresh status'}</button></div>
        <p className="supporting-note">Latest 100 outgoing delivery records, retained for 90 days. Original message content is not archived. History is read-only; refreshing does not send or retry a post. Uncertain means Discord could not confirm whether the post was delivered.</p>
        {historyError ? <ErrorNotice message={historyError} /> : null}
        {historyLoading && !deliveries ? <Loading>Loading delivery history…</Loading> : null}
        {!historyLoading && deliveries?.length === 0 ? <p>No Instagram deliveries in the last 90 days.</p> : null}
        {deliveries?.length ? <ol className="instagram-deliveries">{deliveries.map(delivery => <li key={delivery.jobId}>
          <div className="instagram-delivery-heading"><h3>{delivery.embedTitle}</h3><strong className={`instagram-delivery-status instagram-delivery-${delivery.status}`}>{deliveryLabels[delivery.status]}</strong></div>
          <p><a href={delivery.url} target="_blank" rel="noreferrer">{delivery.url}<ExternalLink className="inline-icon" size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></p>
          <dl><dt>Source</dt><dd>{channelLabel(delivery.sourceChannelId)}</dd><dt>Destination</dt><dd>{channelLabel(delivery.destinationChannelId)}</dd><dt>Recorded</dt><dd><time dateTime={new Date(delivery.createdAt).toISOString()}>{new Date(delivery.createdAt).toLocaleString()}</time></dd></dl>
          {delivery.status === 'sent' && delivery.messageId ? <a className="delivery-link" href={`https://discord.com/channels/${encodeURIComponent(detail.guild.id)}/${encodeURIComponent(delivery.destinationChannelId)}/${encodeURIComponent(delivery.messageId)}`} target="_blank" rel="noreferrer">View confirmed Discord message<ExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : null}
        </li>)}</ol> : null}
      </section>
    </>}
  </>;
}
