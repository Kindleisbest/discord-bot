import { CircleAlert, LoaderCircle } from 'lucide-react';

export function Loading({ children = 'Loading your workspace…' }: { children?: string }) {
  return <div className="status-line" role="status"><LoaderCircle size={22} aria-hidden="true" /><span>{children}</span></div>;
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-notice" role="alert"><CircleAlert size={22} aria-hidden="true" /><div><p>{message}</p>{retry ? <button className="text-button" onClick={retry}>Try again</button> : null}</div></div>;
}

export function DiscordIcon() {
  return <svg width="25" height="21" viewBox="0 0 24 20" aria-hidden="true" fill="currentColor"><path d="M19.7 1.7A19 19 0 0 0 15.3.3l-.6 1.2a16.6 16.6 0 0 0-5.4 0L8.7.3A19 19 0 0 0 4.3 1.7C1.5 5.8.7 9.9 1.1 13.9a18 18 0 0 0 5.4 2.8l1.1-1.8-1.7-.8.4-.3a13.5 13.5 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.8c.5-4.6-.8-8.7-3.2-12.2ZM8.3 11.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" /></svg>;
}
