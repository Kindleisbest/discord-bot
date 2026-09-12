import { BookOpen, CalendarDays, Home, LogOut, MessageSquare, Inbox, Camera, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GuildSummary, Session } from '../api';

export type Page = 'overview' | 'messages' | 'inbox' | 'events' | 'tutorial' | 'instagram' | 'permissions' | 'setup' | 'accessibility' | 'privacy';

export function Shell({ children, page, session, guilds, selectedGuild, onGuildChange, onLogout, onResetTutorial, loggingOut }: {
  children: ReactNode; page: Page; session: Session | null; guilds: GuildSummary[]; selectedGuild: string;
  onGuildChange: (id: string) => void; onLogout: () => void; onResetTutorial: () => void; loggingOut: boolean;
}) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <aside className="sidebar" aria-label="Workspace navigation">
      <a className="brand" href="#overview">Discord Bot</a>
      <nav aria-label="Main navigation"><p className="nav-label">Workspace</p>
        <a className={`nav-link ${page === 'overview' ? 'selected' : ''}`} href="#overview" aria-current={page === 'overview' ? 'page' : undefined}><Home aria-hidden="true" />Overview</a>
        <a className={`nav-link ${page === 'messages' ? 'selected' : ''}`} href="#messages" aria-current={page === 'messages' ? 'page' : undefined}><MessageSquare aria-hidden="true" />Messages</a>
        <a className={`nav-link ${page === 'inbox' ? 'selected' : ''}`} href="#inbox" aria-current={page === 'inbox' ? 'page' : undefined}><Inbox aria-hidden="true" />Staff inbox</a>
        <a className={`nav-link ${page === 'events' ? 'selected' : ''}`} href="#events" aria-current={page === 'events' ? 'page' : undefined}><CalendarDays aria-hidden="true" />Events</a>
        <a className={`nav-link ${page === 'tutorial' ? 'selected' : ''}`} href="#tutorial" aria-current={page === 'tutorial' ? 'page' : undefined}><BookOpen aria-hidden="true" />Member tutorial</a>
        <a className={`nav-link ${page === 'instagram' ? 'selected' : ''}`} href="#instagram" aria-current={page === 'instagram' ? 'page' : undefined}><Camera aria-hidden="true" />Instagram</a>
        <a className={`nav-link ${page === 'permissions' ? 'selected' : ''}`} href="#permissions" aria-current={page === 'permissions' ? 'page' : undefined}><Users aria-hidden="true" />Permissions</a>
      </nav>
      <p className="sidebar-note">Your servers, clearly separated.</p>
    </aside>
    <div className="workspace">
      <header className="topbar">
        {session && guilds.length ? <div className="server-picker"><label htmlFor="server">Server</label><select id="server" value={selectedGuild} onChange={event => onGuildChange(event.target.value)}><option value="">Choose a server</option>{guilds.map(guild => <option key={guild.id} value={guild.id}>{guild.name}{guild.isOwner ? ' · Owner' : ''}</option>)}</select></div> : null}
        <div className="header-actions">
          {session ? <><span className="signed-in-user">{session.user.username}</span><button className="text-button tutorial-reset" onClick={onResetTutorial}>Reset website walkthrough</button><button className="icon-button" title="Sign out" aria-label="Sign out" disabled={loggingOut} onClick={onLogout}><LogOut size={21} aria-hidden="true" /></button></> : null}
          <a className="button button-outline" href="#setup"><BookOpen size={22} aria-hidden="true" />Setup guide</a>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="footer"><a href="#accessibility">Accessibility statement</a><span aria-hidden="true">|</span><a href="#privacy">Privacy &amp; retention</a></footer>
    </div>
  </div>;
}
