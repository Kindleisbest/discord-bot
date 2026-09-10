import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Save } from 'lucide-react';
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '../../../shared/permissions';
import { api, ApiError, errorMessage, type GuildDetail } from '../api';
import { ErrorNotice } from '../components/Status';

export function Permissions({ detail, csrfToken, onSaved, onAccessError }: { detail: GuildDetail; csrfToken: string; onSaved: () => void; onAccessError: (error: ApiError) => void }) {
  const [roleId, setRoleId] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canManage = detail.access.permissions.includes('permissions.manage');
  const roles = [...detail.roles].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
  const role = roles.find(item => item.id === roleId);
  const editable = role ? detail.editableRoleIds.includes(role.id) : false;
  const existing = detail.grants.find(grant => grant.roleId === roleId)?.permissions ?? [];
  const changed = selected.length !== existing.length || selected.some(permission => !existing.includes(permission));

  function chooseRole(id: string) {
    setRoleId(id); setSelected([...(detail.grants.find(grant => grant.roleId === id)?.permissions ?? [])]); setError('');
  }
  async function save() {
    if (!roleId || !editable || saving) return;
    setSaving(true); setError('');
    try {
      await api<{ ok: true }>(`/api/guilds/${encodeURIComponent(detail.guild.id)}/permissions/${encodeURIComponent(roleId)}`, { method: 'PUT', body: { permissions: selected }, csrfToken });
      if (alive.current) onSaved();
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) onAccessError(error);
      else setError(errorMessage(error));
    } finally { if (alive.current) setSaving(false); }
  }

  return <>
    <div className="page-heading"><h1>Website permissions</h1><p>Set what administrators can do in {detail.guild.name}.</p></div>
    <div className="access-summary"><LockKeyhole size={24} aria-hidden="true" /><p>Discord login and Administrator permission are always required. The server owner always has full access.</p></div>
    {!canManage ? <section className="empty-state"><h2>Managed by your server owner</h2><p>You do not have permission to manage roles. Ask the owner or a higher authorized administrator to adjust your access.</p></section> : <section className="permission-editor" aria-labelledby="role-heading">
      <h2 id="role-heading">Role access</h2><p>{detail.access.isOwner ? 'As the owner, you can change website permissions for any role.' : 'You can manage eligible roles below your highest Discord role and grant permissions you already have.'}</p>
      <div className="field"><label htmlFor="role">Discord role</label><select id="role" value={roleId} onChange={event => chooseRole(event.target.value)} disabled={saving}><option value="">Choose a role</option>{roles.map(item => <option value={item.id} key={item.id}>{item.name}{detail.editableRoleIds.includes(item.id) ? '' : ' · View only'}</option>)}</select></div>
      {role ? <>
        {!editable ? <p className="supporting-note">This role is protected by Discord hierarchy, role membership, or permissions granted by a higher administrator. Its grants are shown for reference.</p> : null}
        <fieldset className="permission-options" disabled={!editable || saving}><legend>Website permissions for {role.name}</legend>{PERMISSIONS.map(permission => <label className="checkbox-row" key={permission}><input type="checkbox" checked={selected.includes(permission)} disabled={!detail.access.isOwner && !detail.access.permissions.includes(permission)} onChange={event => setSelected(current => event.target.checked ? [...current, permission] : current.filter(item => item !== permission))} /><span>{PERMISSION_LABELS[permission]}</span></label>)}</fieldset>
        <p className="supporting-note">Administrators always have basic activity access. Channel messaging, the staff inbox, and event creation are available now. Inbox replies and closing conversations require both Read staff inbox and Reply to members; Manage settings controls member contact. Event creation also requires Send channel messages for its announcement. Permissions for future audit, member tutorial, and Instagram tools can be prepared in advance.</p>
        {error ? <ErrorNotice message={error} /> : null}
        {editable ? <button className="button button-primary" disabled={!changed || saving} onClick={() => void save()}><Save size={19} aria-hidden="true" />{saving ? 'Saving permissions…' : 'Save permissions'}</button> : null}
      </> : <p className="supporting-note">Choose a role to view its current website access.</p>}
    </section>}
  </>;
}
