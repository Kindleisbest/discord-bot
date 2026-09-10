import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ExternalLink, Eye, RefreshCw } from 'lucide-react';
import type { EventDraft, EventOptions, EventRecord } from '../../../shared/events';
import { api, ApiError, errorMessage, isAborted, type GuildDetail } from '../api';
import { ErrorNotice, Loading } from '../components/Status';

interface EventForm {
  name: string; description: string; start: string; end: string;
  entityType: EventDraft['entityType'] | ''; channelId: string; location: string;
  announcementChannelId: string; announcementText: string; graphicData: string; graphicAlt: string;
}
const emptyForm = (): EventForm => ({ name: '', description: '', start: '', end: '', entityType: '', channelId: '', location: '', announcementChannelId: '', announcementText: '', graphicData: '', graphicAlt: '' });
const EVENT_LABELS: Record<EventRecord['eventStatus'], string> = { pending: 'Creation in progress', created: 'Created', failed: 'Not created', uncertain: 'Creation unconfirmed' };
const ANNOUNCEMENT_LABELS: Record<EventRecord['announcementStatus'], string> = { not_started: 'Not sent', pending: 'Sending in progress', sent: 'Sent', failed: 'Not sent — sending failed', uncertain: 'Delivery unconfirmed' };
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long', timeZone: browserZone });
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : `${dateFormatter.format(date)} (${browserZone})`; }
function canRetryAnnouncement(record: EventRecord) { return record.eventStatus === 'created' && (record.announcementStatus === 'failed' || record.announcementStatus === 'not_started'); }
function isSettled(record: EventRecord) { return record.eventStatus === 'failed' || (record.eventStatus === 'created' && ['sent', 'failed', 'not_started'].includes(record.announcementStatus)); }

// A local time in a daylight-saving gap must not silently move to another hour.
function localTimeToIso(value: string, label: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  const date = new Date(value);
  if (!parts || Number.isNaN(date.getTime()) || date.getFullYear() !== Number(parts[1]) || date.getMonth() + 1 !== Number(parts[2]) || date.getDate() !== Number(parts[3]) || date.getHours() !== Number(parts[4]) || date.getMinutes() !== Number(parts[5])) {
    throw new Error(`Choose a valid ${label} time in ${browserZone}. Some times do not exist when the clocks change.`);
  }
  return date.toISOString();
}

function buildDraft(form: EventForm, options: EventOptions): EventDraft {
  const name = form.name.trim();
  const description = form.description.trim();
  if (!name || name.length > 100) throw new Error('Enter an event name of 1–100 characters.');
  if (description.length > 1000) throw new Error('Keep the event description within 1,000 characters.');
  const startTime = localTimeToIso(form.start, 'start');
  const endTime = localTimeToIso(form.end, 'end');
  if (new Date(startTime).getTime() < Date.now() + 60_000) throw new Error('Choose a start time at least one minute in the future.');
  if (new Date(endTime).getTime() <= new Date(startTime).getTime()) throw new Error('The end time must be later than the start time.');
  if (!form.entityType) throw new Error('Choose where the event will take place.');
  if (form.entityType === 'external') {
    if (!options.externalAllowed) throw new Error('External events are unavailable. Refresh the event options.');
    if (!form.location.trim() || form.location.trim().length > 100) throw new Error('Enter an event location of 1–100 characters.');
  } else if (!options.eventChannels.some(channel => channel.id === form.channelId && channel.type === form.entityType)) {
    throw new Error(`Choose an available ${form.entityType === 'voice' ? 'voice' : 'Stage'} channel.`);
  }
  if (!options.announcementChannels.some(channel => channel.id === form.announcementChannelId)) throw new Error('Choose an available announcement channel.');
  if (form.announcementText.trim().length > 2000) throw new Error('Keep the announcement text within 2,000 characters.');
  if (form.graphicData && (!form.graphicAlt.trim() || form.graphicAlt.trim().length > 500)) throw new Error('Describe the graphic in 1–500 characters so people using screen readers can understand it.');
  return { name, description, startTime, endTime, entityType: form.entityType, channelId: form.entityType === 'external' ? null : form.channelId, location: form.entityType === 'external' ? form.location.trim() : null, announcementChannelId: form.announcementChannelId, announcementText: form.announcementText.trim(), graphic: form.graphicData ? { data: form.graphicData, alt: form.graphicAlt.trim() } : null };
}

function EventStatus({ record, guildId, canSend, disabled, action, onCheck, onRetry }: {
  record: EventRecord; guildId: string; canSend: boolean; disabled: boolean; action: string;
  onCheck: () => void; onRetry: () => void;
}) {
  const uncertain = record.eventStatus === 'uncertain' || record.announcementStatus === 'uncertain';
  return <>
    <dl className="message-recipient event-status-list" aria-live="polite">
      <dt>Discord event</dt><dd>{EVENT_LABELS[record.eventStatus]}</dd>
      <dt>Announcement</dt><dd>{ANNOUNCEMENT_LABELS[record.announcementStatus]}</dd>
    </dl>
    {uncertain ? <p className="supporting-note">Discord has not confirmed the result. Check status and look in Discord before creating another event or announcement.</p> : null}
    {record.eventStatus === 'failed' ? <p className="supporting-note">The event was not created, so no announcement was sent. Review the bot’s event permissions in Discord before trying a new request.</p> : null}
    {canRetryAnnouncement(record) ? <p className="supporting-note">Your event exists. You can send its missing announcement separately.</p> : null}
    <div className="composer-actions">
      {record.eventId ? <a className="button button-outline button-small" href={`https://discord.com/events/${encodeURIComponent(guildId)}/${encodeURIComponent(record.eventId)}`} target="_blank" rel="noreferrer">View event in Discord<ExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : null}
      <button className="button button-outline button-small" disabled={disabled} onClick={onCheck}><RefreshCw size={16} aria-hidden="true" />{action === `check:${record.requestId}` ? 'Checking…' : 'Check status'}</button>
      {canSend && canRetryAnnouncement(record) ? <button className="button button-outline button-small" disabled={disabled} onClick={onRetry}>{action === `announce:${record.requestId}` ? 'Sending…' : 'Send missing announcement'}</button> : null}
    </div>
  </>;
}

export function Events({ detail, csrfToken, onAccessError }: { detail: GuildDetail; csrfToken: string; onAccessError: (error: ApiError) => void }) {
  const guildId = detail.guild.id;
  const base = `/api/guilds/${encodeURIComponent(guildId)}/events`;
  const canManage = detail.access.permissions.includes('events.manage');
  const canSend = detail.access.permissions.includes('messages.send');
  const [options, setOptions] = useState<EventOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [records, setRecords] = useState<EventRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [form, setForm] = useState<EventForm>(emptyForm);
  const [review, setReview] = useState<EventDraft | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [record, setRecord] = useState<EventRecord | null>(null);
  const [rejected, setRejected] = useState(false);
  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState('');
  const [readingGraphic, setReadingGraphic] = useState(false);
  const alive = useRef(true);
  const createLock = useRef(false);
  const actionLock = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const graphicReader = useRef<FileReader | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorFocus = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = action !== '';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controllers.current.forEach(controller => controller.abort()); graphicReader.current?.abort(); };
  }, []);
  useEffect(() => { if (review || requestId) heading.current?.focus(); }, [review, requestId]);
  useEffect(() => { if (actionError) errorFocus.current?.focus(); }, [actionError]);
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setOptions(null); setOptionsError('');
    void api<{ options: EventOptions }>(`${base}/options`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setOptions(result.options);
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setOptionsError(errorMessage(error));
    });
    return () => controller.abort();
  }, [base, canManage, optionsRevision, onAccessError]);
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError('');
    void api<{ records: EventRecord[] }>(base, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setRecords(result.records);
    }).catch(error => {
      if (controller.signal.aborted || isAborted(error)) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setHistoryError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [base, canManage, historyRevision, onAccessError]);

  function updateRecord(updated: EventRecord) {
    if (updated.requestId === requestId) setRecord(updated);
    setRecords(current => [updated, ...current.filter(item => item.requestId !== updated.requestId)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100));
  }
  function handleError(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
    else setActionError(errorMessage(error));
  }
  function field<K extends keyof EventForm>(key: K, value: EventForm[K]) { setForm(current => ({ ...current, [key]: value })); }
  function reviewEvent() {
    if (!options || readingGraphic || actionLock.current || createLock.current) return;
    setActionError('');
    try { setReview(buildDraft(form, options)); } catch (error) { handleError(error); }
  }
  function readGraphic(file: File | undefined) {
    graphicReader.current?.abort(); graphicReader.current = null; setReadingGraphic(false); setActionError('');
    field('graphicData', '');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1024 * 1024 || file.size === 0) {
      setActionError('Choose a PNG or JPEG graphic no larger than 1 MiB.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const reader = new FileReader(); graphicReader.current = reader; setReadingGraphic(true);
    reader.onload = () => {
      if (!alive.current || graphicReader.current !== reader) return;
      const data = String(reader.result);
      const image = new Image();
      image.onload = () => {
        if (!alive.current || graphicReader.current !== reader) return;
        if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) {
          setActionError('Choose a graphic with no side longer than 8,192 pixels and no more than 16 million pixels in total.');
          if (fileInput.current) fileInput.current.value = '';
        } else field('graphicData', data);
        setReadingGraphic(false);
      };
      image.onerror = () => { if (alive.current && graphicReader.current === reader) { setActionError('This graphic could not be opened. Choose a valid PNG or JPEG.'); setReadingGraphic(false); } };
      image.src = data;
    };
    reader.onerror = () => { if (alive.current && graphicReader.current === reader) { setActionError('The graphic could not be read. Choose the file again.'); setReadingGraphic(false); } };
    reader.readAsDataURL(file);
  }
  async function createEvent() {
    if (createLock.current || actionLock.current || !review || !options || !canSend || !canManage) return;
    try { buildDraft(form, options); } catch (error) { handleError(error); return; }
    createLock.current = true; actionLock.current = true;
    const id = crypto.randomUUID();
    const controller = new AbortController(); controllers.current.add(controller);
    setRequestId(id); setAction('create'); setActionError(''); setRejected(false);
    try {
      const result = await api<{ record: EventRecord }>(base, { method: 'POST', body: { requestId: id, draft: review }, csrfToken, signal: controller.signal });
      if (alive.current) { setRecord(result.record); updateRecord(result.record); }
    } catch (error) {
      if (!alive.current || isAborted(error)) return;
      handleError(error);
      if (error instanceof ApiError && [400, 409, 413, 415, 422, 429].includes(error.status)) setRejected(true);
    } finally {
      controllers.current.delete(controller); actionLock.current = false;
      if (alive.current) setAction('');
    }
  }
  async function checkStatus(id: string) {
    if (actionLock.current) return;
    actionLock.current = true; setAction(`check:${id}`); setActionError('');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const result = await api<{ record: EventRecord }>(`${base}/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (alive.current) { updateRecord(result.record); if (id === requestId) setRejected(false); }
    } catch (error) {
      if (!alive.current || isAborted(error)) return;
      if (error instanceof ApiError && error.status === 404) setActionError('No event request was found. Check Discord before starting another event. Keep this page open and check status again if the original request may still be running.');
      else handleError(error);
    } finally {
      controllers.current.delete(controller); actionLock.current = false;
      if (alive.current) setAction('');
    }
  }
  async function sendMissingAnnouncement(target: EventRecord) {
    if (actionLock.current || !canSend || !canManage || !canRetryAnnouncement(target)) return;
    actionLock.current = true; setAction(`announce:${target.requestId}`); setActionError('');
    updateRecord({ ...target, announcementStatus: 'pending' });
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const result = await api<{ record: EventRecord }>(`${base}/${encodeURIComponent(target.requestId)}/announce`, { method: 'POST', body: {}, csrfToken, signal: controller.signal });
      if (alive.current) updateRecord(result.record);
    } catch (error) {
      if (!alive.current || isAborted(error)) return;
      updateRecord({ ...target, announcementStatus: 'uncertain' }); handleError(error);
    } finally {
      controllers.current.delete(controller); actionLock.current = false;
      if (alive.current) setAction('');
    }
  }
  function resetDraft(edit = false) {
    if (actionLock.current || (!rejected && (!record || !isSettled(record)))) return;
    if (!edit) setForm(emptyForm());
    setReview(null); setRequestId(null); setRecord(null); setRejected(false); setActionError(''); createLock.current = false;
    setOptionsRevision(value => value + 1);
    requestAnimationFrame(() => heading.current?.focus());
  }

  const eventChannel = options?.eventChannels.find(channel => channel.id === form.channelId);
  const announcementChannel = options?.announcementChannels.find(channel => channel.id === form.announcementChannelId);
  return <>
    <div className="page-heading"><h1>Events</h1><p>Create an event and announce it in {detail.guild.name}.</p></div>
    {!canManage ? <section className="empty-state"><h2>Event access is required</h2><p>Ask the server owner or an authorized higher administrator for the Manage events website permission.</p></section> : <>
      {actionError ? <div ref={errorFocus} tabIndex={-1} className="event-error-focus"><ErrorNotice message={actionError} /></div> : null}
      {!canSend ? <p className="supporting-note">You can view event history. Creating events and sending announcements also requires the Send channel messages website permission.</p> : null}
      {canSend ? <>
        {optionsError ? <ErrorNotice message={optionsError} retry={() => setOptionsRevision(value => value + 1)} /> : options ? <div className="composer-status"><p>Event destinations and announcement channels are ready.</p><button className="button button-outline button-small" disabled={busy} onClick={() => setOptionsRevision(value => value + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh options</button></div> : <Loading>Loading event destinations and channels…</Loading>}
        <section className="message-composer event-composer" aria-labelledby="event-composer-title">
          <h2 ref={heading} id="event-composer-title" tabIndex={-1}>{requestId ? 'Event request' : review ? 'Review your event' : 'New event'}</h2>
          {requestId ? <>
            <h3 className="event-request-name">{review?.name}</h3>
            {record ? <EventStatus record={record} guildId={guildId} canSend={canSend} disabled={busy} action={action} onCheck={() => void checkStatus(record.requestId)} onRetry={() => void sendMissingAnnouncement(record)} /> : <>
              <dl className="message-recipient event-status-list" aria-live="polite"><dt>Discord event</dt><dd>{rejected ? 'Request not accepted' : busy ? 'Submitting request…' : 'Creation unconfirmed'}</dd><dt>Announcement</dt><dd>{rejected ? 'Not sent' : 'Waiting for confirmation'}</dd></dl>
              {!rejected ? <p className="supporting-note">Keep this page open while the result is unconfirmed. Check status to read the existing request; this will not create an event or send a message.</p> : null}
              <button className="button button-outline" disabled={busy} onClick={() => void checkStatus(requestId)}><RefreshCw size={17} aria-hidden="true" />{action === `check:${requestId}` ? 'Checking…' : 'Check status'}</button>
            </>}
            <p className="supporting-note">Request reference: <code>{requestId}</code></p>
            {rejected || (record && isSettled(record)) ? <button className="button button-outline" disabled={busy} onClick={() => resetDraft(rejected)}>{rejected ? 'Edit draft' : 'Start a new event'}</button> : null}
          </> : review ? <>
            <dl className="message-recipient event-review-details"><dt>Server</dt><dd>{detail.guild.name}</dd><dt>Event</dt><dd>{review.name}</dd><dt>Starts</dt><dd>{dateLabel(review.startTime)}</dd><dt>Ends</dt><dd>{dateLabel(review.endTime)}</dd><dt>Location</dt><dd>{review.entityType === 'external' ? review.location : `${review.entityType === 'stage' ? 'Stage' : 'Voice'}: ${eventChannel?.name ?? review.channelId}`}</dd><dt>Announcement</dt><dd>#{announcementChannel?.name ?? review.announcementChannelId}</dd></dl>
            {review.description ? <><h3 className="preview-label">Event description</h3><div className="message-preview event-description">{review.description}</div></> : null}
            <h3 className="preview-label">Announcement preview</h3>{review.announcementText ? <div className="message-preview">{review.announcementText}</div> : <p className="supporting-note">The announcement will use the event details, with no additional message text.</p>}
            {review.graphic ? <figure className="event-graphic"><img src={review.graphic.data} alt={review.graphic.alt} /><figcaption>{review.graphic.alt}</figcaption></figure> : null}
            <p className="supporting-note">Creating this event also sends the announcement to the selected channel. The announcement will include the event details and a link to the Discord event{review.graphic ? ', with your graphic' : ''}.</p>
            <div className="composer-actions"><button className="button button-outline" onClick={() => { setReview(null); setActionError(''); requestAnimationFrame(() => heading.current?.focus()); }}><ArrowLeft size={18} aria-hidden="true" />Edit event</button><button className="button button-primary" disabled={!options || busy} onClick={() => void createEvent()}><CalendarDays size={19} aria-hidden="true" />Create event &amp; announce</button></div>
          </> : <form onSubmit={event => { event.preventDefault(); reviewEvent(); }} noValidate>
            <fieldset className="event-fields" disabled={!options || busy}>
              <legend className="sr-only">Event details and announcement</legend>
              <div className="field"><label htmlFor="event-name">Event name</label><input id="event-name" value={form.name} maxLength={100} required onChange={event => field('name', event.target.value)} /></div>
              <div className="field message-content-field"><label htmlFor="event-description">Description <span className="event-optional">(optional)</span></label><textarea id="event-description" value={form.description} maxLength={1000} rows={4} aria-describedby="event-description-count" onChange={event => field('description', event.target.value)} /><p id="event-description-count" className="character-count">{form.description.length.toLocaleString()} / 1,000 characters</p></div>
              <p className="supporting-note" id="event-timezone">Times use your browser’s time zone: {browserZone}. Review the full dates and time zone before creating the event.</p>
              <div className="event-field-grid"><div className="field"><label htmlFor="event-start">Start ({browserZone})</label><input id="event-start" type="datetime-local" step={60} required value={form.start} aria-describedby="event-timezone" onChange={event => field('start', event.target.value)} /></div><div className="field"><label htmlFor="event-end">End ({browserZone})</label><input id="event-end" type="datetime-local" step={60} required value={form.end} aria-describedby="event-timezone" onChange={event => field('end', event.target.value)} /></div></div>
              <div className="event-field-grid"><div className="field"><label htmlFor="event-type">Event location type</label><select id="event-type" value={form.entityType} required onChange={event => setForm(current => ({ ...current, entityType: event.target.value as EventForm['entityType'], channelId: '' }))}><option value="">Choose a location type</option><option value="external" disabled={!options?.externalAllowed}>External location</option><option value="voice" disabled={!options?.eventChannels.some(channel => channel.type === 'voice')}>Voice channel</option><option value="stage" disabled={!options?.eventChannels.some(channel => channel.type === 'stage')}>Stage channel</option></select></div>
                {form.entityType === 'external' ? <div className="field"><label htmlFor="event-location">Location or meeting link</label><input id="event-location" value={form.location} maxLength={100} required onChange={event => field('location', event.target.value)} /></div> : form.entityType ? <div className="field"><label htmlFor="event-channel">{form.entityType === 'voice' ? 'Voice' : 'Stage'} channel</label><select id="event-channel" value={form.channelId} required onChange={event => field('channelId', event.target.value)}><option value="">Choose a channel</option>{options?.eventChannels.filter(channel => channel.type === form.entityType).map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div> : null}
              </div>
              <div className="field"><label htmlFor="event-announcement-channel">Announcement channel</label><select id="event-announcement-channel" value={form.announcementChannelId} required onChange={event => field('announcementChannelId', event.target.value)}><option value="">Choose a text channel</option>{options?.announcementChannels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></div>
              {options && (!options.announcementChannels.length || (!options.externalAllowed && !options.eventChannels.length)) ? <p className="supporting-note">No complete event destination and announcement channel combination is available. Check the bot’s permissions in Discord, then refresh options.</p> : null}
              <div className="field message-content-field"><label htmlFor="event-announcement">Announcement text <span className="event-optional">(optional)</span></label><textarea id="event-announcement" value={form.announcementText} maxLength={2000} rows={5} aria-describedby="event-announcement-count event-announcement-help" onChange={event => field('announcementText', event.target.value)} /><p id="event-announcement-count" className="character-count">{form.announcementText.length.toLocaleString()} / 2,000 characters</p><p className="event-field-help" id="event-announcement-help">The announcement always includes the event details and its Discord link.</p></div>
              <div className="field"><label htmlFor="event-graphic">Event and announcement graphic <span className="event-optional">(optional)</span></label><input ref={fileInput} id="event-graphic" type="file" accept="image/png,image/jpeg" aria-describedby="event-graphic-help" onChange={event => readGraphic(event.target.files?.[0])} /><p className="event-field-help" id="event-graphic-help">PNG or JPEG, up to 1 MiB. Maximum 8,192 pixels per side and 16 million pixels total.</p></div>
              {readingGraphic ? <Loading>Reading graphic…</Loading> : null}
              {form.graphicData ? <><div className="field message-content-field"><label htmlFor="event-graphic-alt">Graphic description</label><textarea id="event-graphic-alt" value={form.graphicAlt} maxLength={500} required rows={3} aria-describedby="event-graphic-alt-help" onChange={event => field('graphicAlt', event.target.value)} /><p className="event-field-help" id="event-graphic-alt-help">Required for accessibility. Describe the graphic and include any meaningful text, up to 500 characters.</p></div><figure className="event-graphic"><img src={form.graphicData} alt={form.graphicAlt || 'Selected event graphic preview'} /></figure><button className="text-button" type="button" onClick={() => { field('graphicData', ''); field('graphicAlt', ''); if (fileInput.current) fileInput.current.value = ''; }}>Remove graphic</button></> : null}
              <div className="composer-actions event-review-action"><button className="button button-primary" disabled={readingGraphic || !options?.announcementChannels.length} type="submit"><Eye size={19} aria-hidden="true" />Review event</button></div>
            </fieldset>
          </form>}
        </section>
      </> : null}
      <section className="activity-section event-history" aria-labelledby="event-history-title"><div className="section-heading"><h2 id="event-history-title">Recent event requests</h2><button className="button button-outline button-small" disabled={historyLoading || busy} onClick={() => setHistoryRevision(value => value + 1)}><RefreshCw size={17} aria-hidden="true" />Refresh history</button></div>
        <p className="supporting-note">The latest 100 requests from this website. Status checks are available even when the bot cannot load event options.</p>
        {historyError ? <ErrorNotice message={historyError} retry={() => setHistoryRevision(value => value + 1)} /> : null}
        {historyLoading ? <Loading>Loading event history…</Loading> : records.filter(item => item.requestId !== requestId).length ? <ul className="event-history-list">{records.filter(item => item.requestId !== requestId).map(item => <li className="event-card" key={item.requestId}><h3>{item.draft.name}</h3><p className="event-history-time">Starts {dateLabel(item.draft.startTime)}</p><EventStatus record={item} guildId={guildId} canSend={canSend} disabled={busy} action={action} onCheck={() => void checkStatus(item.requestId)} onRetry={() => void sendMissingAnnouncement(item)} /></li>)}</ul> : !historyError ? <p className="supporting-note">{requestId ? 'Other event requests will appear here.' : 'No event requests yet. Created events and announcement results will appear here.'}</p> : null}
      </section>
    </>}
  </>;
}
