import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from './api';
import { Onboarding } from './components/Onboarding';
import { Shell, type Page } from './components/Shell';
import { ErrorNotice, Loading } from './components/Status';
import { Information } from './pages/Information';
import { Landing } from './pages/Landing';
import { Overview } from './pages/Overview';
import { Permissions } from './pages/Permissions';
import { useGuildDetail, useGuilds, useSession } from './useWorkspace';

const PAGES: Page[] = ['overview', 'permissions', 'setup', 'accessibility', 'privacy'];
function readPage(): Page { const hash = window.location.hash.slice(1); return PAGES.includes(hash as Page) ? hash as Page : 'overview'; }

export function App() {
  const [page, setPage] = useState<Page>(readPage);
  const auth = useSession();
  const { setSession } = auth;
  const [selectedGuild, setSelectedGuild] = useState('');
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.search).get('login') === 'cancelled' ? 'Discord sign-in was cancelled. You can try again when you are ready.' : '');
  const [actionError, setActionError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [resettingTutorial, setResettingTutorial] = useState(false);
  const onAccessError = useCallback((error: ApiError) => {
    setSelectedGuild(''); setNotice(''); setActionError(errorMessage(error));
    if (error.status === 401) setSession(null);
  }, [setSession]);
  const guilds = useGuilds(auth.session?.user.id, onAccessError);
  const guild = useGuildDetail(auth.session ? selectedGuild : '', onAccessError);
  useEffect(() => {
    function navigate() { setPage(readPage()); setNotice(''); document.getElementById('main-content')?.focus(); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => { document.title = `${page === 'overview' ? 'Overview' : page === 'permissions' ? 'Permissions' : page === 'setup' ? 'Setup guide' : page === 'accessibility' ? 'Accessibility statement' : 'Privacy & retention'} — Discord Bot`; }, [page]);

  async function logout() {
    if (!auth.session || loggingOut) return;
    setLoggingOut(true); setActionError('');
    try {
      await api('/auth/logout', { method: 'POST', csrfToken: auth.session.csrfToken });
      setSession(null); setSelectedGuild(''); setNotice('You have signed out.');
    } catch (error) { if (error instanceof ApiError && error.status === 401) onAccessError(error); else setActionError(errorMessage(error)); }
    finally { setLoggingOut(false); }
  }
  async function resetTutorial() {
    if (!auth.session || resettingTutorial) return;
    setResettingTutorial(true); setActionError('');
    try {
      await api('/api/onboarding', { method: 'POST', body: { completed: false, step: 0 }, csrfToken: auth.session.csrfToken });
      setSession(current => current ? { ...current, onboarding: { completed: false, step: 0 } } : null);
    } catch (error) { if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error); else setActionError(errorMessage(error)); }
    finally { setResettingTutorial(false); }
  }
  function changeGuild(id: string) { setSelectedGuild(id); setNotice(''); setActionError(''); }

  const infoPage = page === 'setup' || page === 'accessibility' || page === 'privacy';
  return <Shell page={page} session={auth.session} guilds={guilds.guilds} selectedGuild={selectedGuild} onGuildChange={changeGuild} onLogout={() => void logout()} loggingOut={loggingOut} onResetTutorial={() => void resetTutorial()}>
    {actionError ? <ErrorNotice message={actionError} /> : null}
    {notice ? <p className="success-notice" role="status">{notice}</p> : null}
    {infoPage ? <Information page={page} /> : auth.loading ? <Loading>Checking your connection…</Loading> : auth.error ? <ErrorNotice message={auth.error} retry={auth.retry} /> : !auth.session ? <Landing configured={auth.status?.configured ?? false} permissions={page === 'permissions'} /> : guilds.loading ? <Loading>Checking your server access…</Loading> : guilds.error ? <ErrorNotice message={guilds.error} retry={guilds.retry} /> : guilds.guilds.length === 0 ? <><div className="page-heading"><h1>No eligible servers yet</h1><p>Your Discord account is signed in, but no accessible server was found.</p></div><div className="empty-state"><h2>Check your server setup</h2><p>The bot must be installed in the server, and you must own it or have Discord’s Administrator permission.</p><button className="button button-outline" onClick={guilds.retry}>Check server access again</button></div></> : !selectedGuild ? <><div className="page-heading"><h1>Choose your server</h1><p>Use the Server menu above to open a workspace.</p></div><p className="supporting-note">Activity and website permissions are kept separate for every server.</p></> : guild.loading || (!guild.detail && !guild.error) ? <Loading>Loading this server’s workspace…</Loading> : guild.error ? <ErrorNotice message={guild.error} retry={guild.refresh} /> : guild.detail ? page === 'permissions' ? <Permissions key={guild.detail.guild.id} detail={guild.detail} csrfToken={auth.session.csrfToken} onAccessError={onAccessError} onSaved={() => { setNotice('Permissions saved. Current Discord access is being checked again.'); guild.refresh(); }} /> : <Overview key={guild.detail.guild.id} detail={guild.detail} onAccessError={onAccessError} /> : null}
    {auth.session && !auth.session.onboarding.completed ? <Onboarding session={auth.session} onAccessError={onAccessError} onChange={onboarding => setSession(current => current ? { ...current, onboarding } : null)} /> : null}
  </Shell>;
}
