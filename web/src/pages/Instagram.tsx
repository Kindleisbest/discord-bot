import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import type { InstagramOptions, InstagramSettings, InstagramSettingsInput } from '../../../shared/instagram';
import { api, ApiError, errorMessage, isAborted, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

function editable(settings: InstagramSettings): InstagramSettingsInput {
  return { sourceChannelIds: [...settings.sourceChannelIds], destinationChannelId: settings.destinationChannelId, embedTitle: settings.embedTitle, embedDescription: settings.embedDescription, embedColor: settings.embedColor, expectedRevision: settings.revision };
}

export function Instagram({ detail, csrfToken, onAccessError, onUnsavedChange }: {
  detail: GuildDetail; csrfToken: string; onAccessError: (error: ApiError) => void; onUnsavedChange: (unsaved: boolean) => void;
}) {
  const canManage = detail.access.permissions.includes('instagram.manage');
  const canSave = canManage && detail.access.permissions.includes('messages.send');
  const [saved, setSaved] = useState<InstagramSettings | null>(null);
  const [draft, setDraft] = useState<InstagramSettingsInput | null>(null);
  const [options, setOptions] = useState<InstagramOptions | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLInputElement>(null);
  const endpoint = `/api/guilds/${encodeURIComponent(detail.guild.id)}/instagram`;
  const dirty = Boolean(saved && draft && JSON.stringify(editable(saved)) !== JSON.stringify(draft));
  const unavailableSources = draft?.sourceChannelIds.filter(id => !options?.sourceChannels.some(channel => channel.id === id)) ?? [];
  const unavailableDestination = Boolean(draft?.destinationChannelId && !options?.destinationChannels.some(channel => channel.id === draft.destinationChannelId));
  const titleInvalid = Boolean(draft && (!draft.embedTitle.trim() || draft.embedTitle.trim().length > 100));
  const colorInvalid = Boolean(draft && !/^#[0-9a-f]{6}$/i.test(draft.embedColor));

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
  useEffect(() => () => saveRequest.current?.abort(), []);
  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    void Promise.all([
      api<{ settings: InstagramSettings }>(endpoint, { signal: controller.signal }),
      api<{ options: InstagramOptions }>(`${endpoint}/options`, { signal: controller.signal }),
    ]).then(([result, choices]) => {
      if (controller.signal.aborted) return;
      setSaved(result.settings); setDraft(editable(result.settings)); setOptions(choices.options);
      setConflict(false); setValidation(false);
      if (loadVersion > 0) setNotice('Saved settings and available channels reloaded.');
    }).catch(requestError => {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else setError(errorMessage(requestError));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, canManage, loadVersion, onAccessError]);

  function reload() {
    if (loading || saving || (dirty && !window.confirm('Discard your unsaved changes and reload the saved Instagram settings?'))) return;
    setNotice(''); setLoadVersion(version => version + 1);
  }
  function update(change: Partial<InstagramSettingsInput>) { setDraft(current => current ? { ...current, ...change } : current); setNotice(''); }
  async function save() {
    if (!draft || !canSave || loading || saving || conflict) return;
    setValidation(true); setError(''); setNotice('');
    if (titleInvalid) { setError('Enter a title of 1 to 100 characters.'); titleInput.current?.focus(); return; }
    if (colorInvalid) { setError('Enter a color as # followed by six hexadecimal digits, such as #5865F2.'); colorInput.current?.focus(); return; }
    if (draft.embedDescription.trim().length > 2000) { setError('Keep the description to 2,000 characters or fewer.'); return; }
    if (draft.sourceChannelIds.length > 25) { setError('Choose at most 25 source channels.'); return; }
    if (draft.destinationChannelId && draft.sourceChannelIds.includes(draft.destinationChannelId)) { setError('The destination must be different from every source channel.'); return; }
    if (unavailableSources.length || unavailableDestination) { setError('Remove unavailable source channels and clear or replace the unavailable destination before saving.'); return; }
    const controller = new AbortController(); saveRequest.current = controller; setSaving(true);
    try {
      const result = await api<{ settings: InstagramSettings }>(endpoint, { method: 'PUT', csrfToken, signal: controller.signal, body: { ...draft, embedTitle: draft.embedTitle.trim(), embedDescription: draft.embedDescription.trim(), embedColor: draft.embedColor.toUpperCase() } });
      if (controller.signal.aborted) return;
      setSaved(result.settings); setDraft(editable(result.settings)); setValidation(false);
      setNotice('Instagram settings saved. Automatic posting remains unavailable.');
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
    <div className="page-heading"><h1>Instagram</h1><p>Prepare channel and embed settings for {detail.guild.name}.</p></div>
    <p className="access-summary" role="status"><strong>Setup only — automatic posting is not available yet.</strong></p>
    {!canManage ? <section className="empty-state"><h2>Instagram settings need permission</h2><p>Ask your server owner or an authorized administrator for the Manage Instagram website permission.</p></section> : <>
      <p className="tutorial-intro">Choose where Instagram links could be collected and where future posts would appear. Source links may become visible to the destination channel’s audience when posting is implemented. Review that audience before choosing channels.</p>
      {!canSave ? <p className="supporting-note">You can view settings. Saving also requires the Send channel messages website permission.</p> : null}
      {loading && !draft ? <Loading>Loading Instagram settings and channels…</Loading> : null}
      {error ? <ErrorNotice message={error} retry={!draft ? reload : undefined} /> : null}
      {notice ? <p className="success-notice" role="status">{notice}</p> : null}
      {draft && options ? <section className="member-tutorial-editor" aria-label="Instagram settings" aria-busy={loading || saving}>
        <div className="tutorial-summary"><p>{saved?.updatedAt ? 'Saved setup' : 'New setup'}{dirty ? ' · Unsaved changes' : ''}</p><button className="button button-outline button-small" onClick={reload} disabled={loading || saving}>{loading ? 'Reloading…' : 'Reload settings and channels'}</button></div>
        {conflict ? <div className="tutorial-conflict" role="alert"><h2>Settings changed in another session</h2><p>Your draft is still here. Copy anything you want to keep, then reload the current saved settings before saving again.</p><button className="button button-outline" disabled={loading || saving} onClick={reload}>Reload current saved settings</button></div> : null}
        <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="tutorial-fields" disabled={!canSave || loading || saving}>
            <legend className="sr-only">Channels and embed appearance</legend>
            <fieldset className="permission-options instagram-sources" aria-describedby="instagram-source-help"><legend>Source channels ({draft.sourceChannelIds.length} / 25)</legend>
              {options.sourceChannels.map(channel => <label className="checkbox-row" key={channel.id}><input type="checkbox" checked={draft.sourceChannelIds.includes(channel.id)} disabled={!draft.sourceChannelIds.includes(channel.id) && (draft.sourceChannelIds.length >= 25 || draft.destinationChannelId === channel.id)} onChange={event => update({ sourceChannelIds: event.target.checked ? [...draft.sourceChannelIds, channel.id] : draft.sourceChannelIds.filter(id => id !== channel.id) })} /><span>#{channel.name}</span></label>)}
              {unavailableSources.map(id => <label className="checkbox-row" key={id}><input type="checkbox" checked onChange={() => update({ sourceChannelIds: draft.sourceChannelIds.filter(value => value !== id) })} /><span>Unavailable channel · {id} — uncheck to remove</span></label>)}
              {!options.sourceChannels.length && !unavailableSources.length ? <p>No source channels are available.</p> : null}
            </fieldset>
            <p className="event-field-help" id="instagram-source-help">Select up to 25 text or announcement channels. You may save a setup with no sources or destination.</p>
            <div className="field"><label htmlFor="instagram-destination">Destination channel</label><select id="instagram-destination" value={draft.destinationChannelId ?? ''} aria-describedby="instagram-destination-help" onChange={event => update({ destinationChannelId: event.target.value || null })}><option value="">No destination selected</option>{unavailableDestination ? <option value={draft.destinationChannelId!}>Unavailable channel · {draft.destinationChannelId}</option> : null}{options.destinationChannels.map(channel => <option key={channel.id} value={channel.id} disabled={draft.sourceChannelIds.includes(channel.id)}>#{channel.name}{draft.sourceChannelIds.includes(channel.id) ? ' · Selected as source' : ''}</option>)}</select><p className="event-field-help" id="instagram-destination-help">Choose a different channel from your sources.{unavailableDestination ? ' This saved destination is unavailable; clear or replace it to save.' : ''}</p></div>
            <div className="field"><label htmlFor="instagram-title">Embed title</label><input id="instagram-title" ref={titleInput} value={draft.embedTitle} maxLength={100} required aria-invalid={validation && titleInvalid || undefined} aria-describedby="instagram-title-help" onChange={event => update({ embedTitle: event.target.value })} /><p className="event-field-help" id="instagram-title-help">Required, up to 100 characters.</p></div>
            <div className="field message-content-field"><label htmlFor="instagram-description">Embed description (optional)</label><textarea id="instagram-description" value={draft.embedDescription} rows={4} maxLength={2000} aria-describedby="instagram-description-help" onChange={event => update({ embedDescription: event.target.value })} /><p className="event-field-help" id="instagram-description-help">{draft.embedDescription.length.toLocaleString()} / 2,000 characters. Title and description are static text; placeholders are not replaced.</p></div>
            <div className="field"><label htmlFor="instagram-color">Embed color</label><input id="instagram-color" ref={colorInput} value={draft.embedColor} maxLength={7} spellCheck={false} required aria-invalid={validation && colorInvalid || undefined} aria-describedby="instagram-color-help" onChange={event => update({ embedColor: event.target.value })} /><p className="event-field-help" id="instagram-color-help">Use a six-digit hex color, such as #5865F2.</p></div>
          </fieldset>
          <section className="tutorial-preview" aria-labelledby="instagram-preview-title"><h2 id="instagram-preview-title">Text preview</h2><div className="message-preview" style={{ borderLeft: `5px solid ${colorInvalid ? '#5865F2' : draft.embedColor}` }}><h3>{draft.embedTitle.trim() || 'Embed title'}</h3>{draft.embedDescription.trim() ? <p>{draft.embedDescription.trim()}</p> : null}</div><p className="event-field-help">Static preview only. No Instagram content is fetched and no messages are sent.</p></section>
          <div className="composer-actions"><button className="button button-primary" type="submit" disabled={!dirty || !canSave || loading || saving || conflict}><Save size={18} aria-hidden="true" />{saving ? 'Saving settings…' : 'Save settings'}</button></div>
        </form>
      </section> : null}
    </>}
  </>;
}
