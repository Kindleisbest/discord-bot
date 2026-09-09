import { LogIn, Settings, Shield, Users } from 'lucide-react';
import { DiscordIcon } from '../components/Status';

export function Landing({ configured, permissions = false }: { configured: boolean; permissions?: boolean }) {
  return <>
    <div className="page-heading"><h1>{permissions ? 'Permissions start with sign-in.' : 'Your community starts here.'}</h1><p>{permissions ? 'Sign in with Discord to view your server’s website permissions.' : 'Connect Discord to manage your servers in one place.'}</p></div>
    <section className="connect-panel" aria-labelledby="connect-title">
      <Shield className="connect-shield" size={74} strokeWidth={1.7} aria-hidden="true" />
      <div><h2 id="connect-title">{configured ? 'Connect your Discord account' : 'Connect your Discord application'}</h2><p>{configured ? 'Sign in securely to choose a server you administer.' : 'Add your application credentials to enable secure sign-in.'}</p>
        {configured ? <a className="button button-primary" href="/auth/login"><DiscordIcon />Continue with Discord</a> : <button className="button button-primary" disabled aria-describedby="configuration-note"><DiscordIcon />Continue with Discord</button>}
        <p className="configuration-note" id="configuration-note">{configured ? 'Discord login and Administrator permission are required.' : 'Waiting for configuration.'}</p>
      </div>
    </section>
    <section className="principles" aria-labelledby="principles-title"><h2 id="principles-title">Built around your server</h2>
      <div className="principle"><LogIn aria-hidden="true" /><div><h3>Discord sign-in</h3><p>Access requires Discord login and Administrator permission.</p></div></div>
      <div className="principle"><Users aria-hidden="true" /><div><h3>Server owner access</h3><p>Owners always retain control of their server.</p></div></div>
      <div className="principle"><Settings aria-hidden="true" /><div><h3>Separate workspaces</h3><p>Each server has its own activity, settings, and permissions.</p></div></div>
    </section>
    <section className="next-steps" aria-labelledby="next-title"><h2 id="next-title">Next steps</h2><ol><li>Create a Discord application</li><li>Add the configuration values</li><li>Sign in and choose a server</li></ol></section>
  </>;
}
