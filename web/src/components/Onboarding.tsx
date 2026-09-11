import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { api, ApiError, errorMessage, type Session } from '../api';
import { ErrorNotice } from './Status';

const STEPS = [
  { title: 'Welcome to your workspace', text: 'This short walkthrough introduces your management website. Your progress is saved, and you can skip or reset this tutorial whenever you need.' },
  { title: 'Choose a server', text: 'Use the Server menu at the top of the page. Only servers where you are the owner or have Discord Administrator permission, and where the bot can verify access, are available. Each server has its own workspace.' },
  { title: 'Understand your access', text: 'Signing in verifies your Discord account. The service also checks your current membership and Administrator permission. Owners always retain full website access, even without a role.' },
  { title: 'Set up role permissions', text: 'Open Permissions to configure website access. Owners can manage every role. Delegated administrators can manage eligible lower roles, using only permissions they already have. Website grants never change Discord roles.' },
  { title: 'Messages and staff contact', text: 'Overview records activity without message text. Use Messages to review and send channel messages. Enable Staff inbox for a server when your team is ready to receive member DMs, then give staff read and reply access. Members choose their server through /contact or the bot’s DM picker. Inbox messages are retained for 90 days; attachment links may expire sooner.' },
  { title: 'Help members get started', text: 'Open Member tutorial to write and publish channel instructions. Members run /tutorial in Discord for a private walkthrough of channels they can access. Setup guide is always available, and Reset website walkthrough reopens this introduction.' },
];

export function Onboarding({ session, onChange, onAccessError }: { session: Session; onChange: (value: Session['onboarding']) => void; onAccessError: (error: ApiError) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(Math.min(5, Math.max(0, session.onboarding.step)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element?.showModal();
    return () => { alive.current = false; element?.close(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);

  async function persist(nextStep: number, completed = false) {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api<{ ok: true }>('/api/onboarding', { method: 'POST', body: { completed, step: nextStep }, csrfToken: session.csrfToken });
      if (alive.current) { setStep(nextStep); onChange({ completed, step: nextStep }); }
    } catch (error) {
      if (!alive.current) return;
      setError(errorMessage(error));
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
    } finally { if (alive.current) setSaving(false); }
  }

  return <dialog ref={dialog} className="tutorial-dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-description" onCancel={event => { event.preventDefault(); void persist(step, true); }}>
    <p className="tutorial-step">Administrator tutorial · Step {step + 1} of {STEPS.length}</p>
    <h2 id="tutorial-title" ref={heading} tabIndex={-1}>{STEPS[step].title}</h2><p id="tutorial-description">{STEPS[step].text}</p>
    {error ? <ErrorNotice message={error} /> : null}
    <div className="tutorial-actions"><button className="text-button" onClick={() => void persist(step, true)} disabled={saving}>Skip tutorial</button><div>{step > 0 ? <button className="button button-outline" onClick={() => void persist(step - 1)} disabled={saving}><ArrowLeft size={17} aria-hidden="true" />Back</button> : null}<button className="button button-primary" onClick={() => void persist(Math.min(5, step + 1), step === 5)} disabled={saving}>{saving ? 'Saving…' : step === 5 ? 'Finish' : 'Continue'}{step === 5 ? <Check size={17} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}</button></div></div>
  </dialog>;
}
