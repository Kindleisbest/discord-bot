import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Save } from 'lucide-react';
import type { TutorialChannel, TutorialStep } from '../../../shared/tutorial';
import { api, ApiError, errorMessage, isAborted, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

interface TutorialResponse { channels: TutorialChannel[]; steps: TutorialStep[] }
type StepContent = Pick<TutorialStep, 'title' | 'body' | 'published'>;
function emptyStep(channelId: string): TutorialStep { return { channelId, title: '', body: '', published: false, revision: 0, updatedAt: null }; }
function configured(step: TutorialStep | undefined) { return Boolean(step && (step.title.trim() || step.body.trim())); }

export function TutorialPage({ detail, csrfToken, onAccessError, onUnsavedChange }: {
  detail: GuildDetail; csrfToken: string; onAccessError: (error: ApiError) => void; onUnsavedChange: (unsaved: boolean) => void;
}) {
  const canManage = detail.access.permissions.includes('tutorial.manage');
  const [data, setData] = useState<TutorialResponse | null>(null);
  const [draft, setDraft] = useState<TutorialStep | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [validation, setValidation] = useState(false);
  const selectedChannel = useRef('');
  const saveRequest = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const endpoint = `/api/guilds/${encodeURIComponent(detail.guild.id)}/tutorial`;
  const saved = draft ? data?.steps.find(step => step.channelId === draft.channelId) ?? emptyStep(draft.channelId) : null;
  const dirty = Boolean(draft && saved && (draft.title !== saved.title || draft.body !== saved.body || draft.published !== saved.published));

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
    void api<TutorialResponse>(endpoint, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const channelId = result.channels.some(channel => channel.id === selectedChannel.current) ? selectedChannel.current : result.channels[0]?.id ?? '';
      selectedChannel.current = channelId;
      setData(result); setDraft(channelId ? result.steps.find(step => step.channelId === channelId) ?? emptyStep(channelId) : null);
      setConflict(false); setValidation(false);
      if (loadVersion > 0) setNotice('The current saved tutorial and channel list have been loaded.');
    }).catch(requestError => {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else setError(errorMessage(requestError));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, canManage, loadVersion, onAccessError]);

  function discardAllowed() { return !dirty || window.confirm('Discard your unsaved tutorial changes?'); }
  function selectChannel(channelId: string) {
    if (!data || saving || loading || channelId === draft?.channelId || !discardAllowed()) return;
    selectedChannel.current = channelId;
    setDraft(data.steps.find(step => step.channelId === channelId) ?? emptyStep(channelId));
    setError(''); setNotice(''); setConflict(false); setValidation(false);
    heading.current?.focus();
  }
  function reload() {
    if (saving || loading || !discardAllowed()) return;
    setNotice(''); setLoadVersion(version => version + 1);
  }
  async function save(content: StepContent, clear = false) {
    if (!draft || saving || loading || conflict || !canManage) return;
    const normalized = { title: content.title.trim(), body: content.body.trim(), published: content.published };
    if (normalized.published && (!normalized.title || !normalized.body)) {
      setValidation(true); setError('Add a title and instructions before publishing this step.');
      if (!normalized.title) titleInput.current?.focus(); else bodyInput.current?.focus();
      return;
    }
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true); setError(''); setNotice(''); setValidation(false);
    try {
      const result = await api<{ step: TutorialStep }>(`${endpoint}/${encodeURIComponent(draft.channelId)}`, {
        method: 'PUT', body: { ...normalized, expectedRevision: draft.revision }, csrfToken, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setData(current => current ? { ...current, steps: [...current.steps.filter(step => step.channelId !== result.step.channelId), result.step] } : current);
      setDraft(result.step);
      setNotice(clear ? 'Step cleared and unpublished.' : result.step.published ? 'Published step saved. Members can now view it with /tutorial.' : 'Draft saved. Members cannot see this step.');
    } catch (requestError) {
      if (controller.signal.aborted || isAborted(requestError)) return;
      if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) onAccessError(requestError);
      else if (requestError instanceof ApiError && requestError.status === 409) { setConflict(true); setError(''); }
      else setError(errorMessage(requestError));
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      if (saveRequest.current === controller) saveRequest.current = null;
    }
  }

  const currentIndex = data?.channels.findIndex(channel => channel.id === draft?.channelId) ?? -1;
  const channel = data?.channels[currentIndex];
  const availableIds = new Set(data?.channels.map(item => item.id));
  const availableSteps = data?.steps.filter(step => availableIds.has(step.channelId)) ?? [];
  const titleMissing = validation && Boolean(draft?.published && !draft.title.trim());
  const bodyMissing = validation && Boolean(draft?.published && !draft.body.trim());

  return <>
    <div className="page-heading"><h1>Member tutorial</h1><p>Help members find their way around {detail.guild.name}.</p></div>
    {!canManage ? <section className="empty-state"><BookOpen size={30} aria-hidden="true" /><h2>Tutorial editing needs permission</h2><p>Ask your server owner or an authorized administrator for the Edit member tutorial website permission.</p></section> : <>
      <p className="tutorial-intro">Write one step for each channel you want to explain. Members run <code>/tutorial</code> in Discord to open a private walkthrough of published steps in channels they can access. They can choose a starting channel, move back or forward, and close the walkthrough. Controls expire after 10 minutes.</p>
      {!data && loading ? <Loading>Loading channels and tutorial steps…</Loading> : null}
      {error ? <ErrorNotice message={error} retry={!data ? reload : undefined} /> : null}
      {!data && !loading ? <p className="supporting-note">The bot must be connected to Discord to check the current channel list. Your saved tutorial stays available when the connection returns.</p> : null}
      {notice ? <p className="success-notice" role="status">{notice}</p> : null}
      {data ? <>
        <div className="tutorial-summary"><p><strong>{availableSteps.filter(configured).length}</strong> of {data.channels.length} channels configured <span aria-hidden="true">·</span> <strong>{availableSteps.filter(step => step.published).length}</strong> published</p><button className="button button-outline button-small" onClick={reload} disabled={loading || saving}>{loading ? 'Reloading…' : 'Reload channels and steps'}</button></div>
        {data.channels.length === 0 ? <section className="empty-state"><BookOpen size={30} aria-hidden="true" /><h2>No available channels</h2><p>Create a supported channel in Discord and make sure the bot can view it, then reload the channel list.</p></section> : draft && channel ? <section className="member-tutorial-editor" aria-labelledby="channel-step-title" aria-busy={loading || saving}>
          <div className="field tutorial-channel-field"><label htmlFor="tutorial-channel">Choose a channel to explain</label><select id="tutorial-channel" value={draft.channelId} onChange={event => selectChannel(event.target.value)} disabled={loading || saving}>{data.channels.map(item => { const step = data.steps.find(value => value.channelId === item.id); return <option value={item.id} key={item.id}>#{item.name} · {step?.published ? 'Published' : configured(step) ? 'Draft' : 'Not configured'}</option>; })}</select></div>
          <div className="tutorial-channel-navigation" aria-label="Channel navigation"><button className="button button-outline button-small" disabled={currentIndex <= 0 || loading || saving} onClick={() => selectChannel(data.channels[currentIndex - 1].id)}><ArrowLeft size={17} aria-hidden="true" />Previous channel</button><p>Channel {currentIndex + 1} of {data.channels.length}</p><button className="button button-outline button-small" disabled={currentIndex === data.channels.length - 1 || loading || saving} onClick={() => selectChannel(data.channels[currentIndex + 1].id)}>Next channel<ArrowRight size={17} aria-hidden="true" /></button></div>
          <div className="tutorial-step-heading"><h2 id="channel-step-title" tabIndex={-1} ref={heading}>Explain #{channel.name}</h2><p>{saved?.published ? 'Published' : configured(saved ?? undefined) ? 'Saved draft' : 'No saved content'}{dirty ? ' · Unsaved changes' : ''}</p></div>
          {conflict ? <div className="tutorial-conflict" role="alert"><h3>This step changed in another session</h3><p>Your draft is still here. Copy any text you want to keep, then reload the current saved version before editing again.</p><button className="button button-outline" disabled={loading || saving} onClick={reload}>Reload current saved version</button></div> : null}
          <form onSubmit={event => { event.preventDefault(); void save(draft); }}>
            <fieldset className="tutorial-fields" disabled={loading || saving}>
              <legend className="sr-only">Tutorial content for {channel.name}</legend>
              <div className="field"><label htmlFor="tutorial-step-title">Step title</label><input id="tutorial-step-title" ref={titleInput} value={draft.title} maxLength={100} aria-describedby="tutorial-title-help" aria-invalid={titleMissing || undefined} onChange={event => setDraft({ ...draft, title: event.target.value })} /><p className="event-field-help" id="tutorial-title-help">{titleMissing ? 'A title is required to publish. ' : ''}A short heading, up to 100 characters.</p></div>
              <div className="field message-content-field"><label htmlFor="tutorial-step-body">Instructions for members</label><textarea id="tutorial-step-body" ref={bodyInput} value={draft.body} maxLength={3000} rows={7} aria-describedby="tutorial-body-help tutorial-body-count" aria-invalid={bodyMissing || undefined} onChange={event => setDraft({ ...draft, body: event.target.value })} /><p className="event-field-help" id="tutorial-body-help">{bodyMissing ? 'Instructions are required to publish. ' : ''}Describe what this channel is for and how members can use it.</p><p className="character-count" id="tutorial-body-count">{draft.body.length.toLocaleString()} / 3,000 characters</p></div>
              <label className="checkbox-row tutorial-publish"><input type="checkbox" checked={draft.published} aria-describedby="tutorial-publish-help" onChange={event => setDraft({ ...draft, published: event.target.checked })} /><span>Publish this step</span></label><p className="event-field-help" id="tutorial-publish-help">Published steps need a title and instructions. Leave this unchecked to save a draft. Changes take effect when you save.</p>
            </fieldset>
            <details className="tutorial-preview"><summary>Preview step text</summary><div className="message-preview"><h3>{draft.title.trim() || 'Step title'}</h3><p>{draft.body.trim() || 'Your instructions will appear here.'}</p></div><p className="event-field-help">Text preview only. Discord may format the text differently.</p></details>
            <div className="composer-actions"><button className="button button-primary" type="submit" disabled={!dirty || loading || saving || conflict}><Save size={18} aria-hidden="true" />{saving ? 'Saving step…' : 'Save step'}</button><button type="button" className="button button-outline" disabled={loading || saving || conflict || (!configured(saved ?? undefined) && !saved?.published && !dirty)} onClick={() => { if (window.confirm(`Clear the tutorial step for #${channel.name}? This removes its saved text and unpublishes it.`)) void save({ title: '', body: '', published: false }, true); }}>Clear step</button></div>
          </form>
        </section> : null}
      </> : null}
      <p className="supporting-note">Saving a tutorial does not send channel messages. Members start it themselves, and the bot checks their channel access as they move through it.</p>
    </>}
  </>;
}
