'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Check, History, MapPin, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react';
import type { WholesaleTeamRole } from '@/lib/wholesale/wholesaleTeam';
import styles from './WholesaleTeamSection.module.css';

type TeamMember = {
  id: number; name: string; email: string; role: WholesaleTeamRole;
  locationId: number; locationName: string; locationIds: number[]; isCurrent: boolean;
};
type BuyingLocation = { id: number; name: string; isPrimary: boolean; status: string };
type TeamEvent = {
  id: number; actorName: string; targetName: string; targetEmail: string;
  action: string; beforeRole: string | null; afterRole: string | null; createdAt: string;
  details?: Record<string, unknown> | null;
};

function eventLabel(event: TeamEvent) {
  if (event.action === 'access_granted') return `added ${event.targetName} as ${event.afterRole}`;
  if (event.action === 'role_changed') return `changed ${event.targetName} from ${event.beforeRole} to ${event.afterRole}`;
  if (event.action === 'access_removed') return `removed ${event.targetName}`;
  if (event.action === 'locations_changed') return `changed buying locations for ${event.targetName}`;
  if (event.action === 'location_created') return `created ${event.targetName}`;
  if (event.action === 'location_renamed') return `renamed ${event.targetName}`;
  if (event.action === 'location_archived') return `archived ${event.targetName}`;
  return `updated ${event.targetName}`;
}

export function WholesaleTeamSection({ role }: { role: WholesaleTeamRole }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [locations, setLocations] = useState<BuyingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'buyer'>('buyer');
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);
  const [pendingArchive, setPendingArchive] = useState<BuyingLocation | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [editingLocation, setEditingLocation] = useState<BuyingLocation | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, number[]>>({});
  const [defaultDrafts, setDefaultDrafts] = useState<Record<number, number>>({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [teamResponse, locationsResponse] = await Promise.all([
        fetch('/api/wholesale/account/team'), fetch('/api/wholesale/account/locations'),
      ]);
      const [body, locationBody] = await Promise.all([teamResponse.json(), locationsResponse.json()]);
      if (!teamResponse.ok || !body.success) throw new Error(body.error || 'Account team could not be loaded.');
      if (!locationsResponse.ok || !locationBody.success) throw new Error(locationBody.error || 'Buying locations could not be loaded.');
      const nextMembers: TeamMember[] = body.members ?? [];
      setMembers(nextMembers);
      setEvents(body.events ?? []);
      setLocations(locationBody.locations ?? []);
      setAssignmentDrafts(Object.fromEntries(nextMembers.map(member => [member.id, member.locationIds])));
      setDefaultDrafts(Object.fromEntries(nextMembers.map(member => [member.id, member.locationId])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Account team could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/account/team', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role: inviteRole }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Team member could not be added.');
      setEmail('');
      setInviteRole('buyer');
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Team member could not be added.');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (member: TeamMember, nextRole: WholesaleTeamRole) => {
    setError('');
    try {
      const response = await fetch(`/api/wholesale/account/team/${member.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: nextRole }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Role could not be changed.');
      await load();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Role could not be changed.');
    }
  };

  const remove = async (member: TeamMember) => {
    setError('');
    try {
      const response = await fetch(`/api/wholesale/account/team/${member.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Team member could not be removed.');
      setPendingRemove(null);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Team member could not be removed.');
    }
  };

  const createLocation = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch('/api/wholesale/account/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newLocationName }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Buying location could not be created.');
      setNewLocationName(''); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Buying location could not be created.'); }
    finally { setSaving(false); }
  };

  const renameLocation = async (event: FormEvent) => {
    event.preventDefault(); if (!editingLocation) return; setSaving(true); setError('');
    try {
      const response = await fetch(`/api/wholesale/account/locations/${editingLocation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editingLocation.name }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Buying location could not be renamed.');
      setEditingLocation(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Buying location could not be renamed.'); }
    finally { setSaving(false); }
  };

  const archiveLocation = async (location: BuyingLocation) => {
    setError('');
    try {
      const response = await fetch(`/api/wholesale/account/locations/${location.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Buying location could not be archived.');
      setPendingArchive(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Buying location could not be archived.'); }
  };

  const toggleAssignment = (member: TeamMember, locationId: number) => {
    const current = assignmentDrafts[member.id] ?? [];
    const next = current.includes(locationId) ? current.filter(id => id !== locationId) : [...current, locationId];
    setAssignmentDrafts(previous => ({ ...previous, [member.id]: next }));
    if (!next.includes(defaultDrafts[member.id])) setDefaultDrafts(previous => ({ ...previous, [member.id]: next[0] ?? 0 }));
  };

  const saveAssignments = async (member: TeamMember) => {
    setError('');
    try {
      const response = await fetch(`/api/wholesale/account/team/${member.id}/locations`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationIds: assignmentDrafts[member.id], defaultLocationId: defaultDrafts[member.id] }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Buying locations could not be assigned.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Buying locations could not be assigned.'); }
  };

  return (
    <section className={styles.section}>
      <div className={styles.heading}><MapPin size={18} /><div><h2>Buying locations</h2><span>{locations.length} active location{locations.length === 1 ? '' : 's'}</span></div></div>
      <form className={styles.locationCreate} onSubmit={createLocation}>
        <input required maxLength={120} value={newLocationName} onChange={event => setNewLocationName(event.target.value)} placeholder="Location name" aria-label="New buying location name" />
        <button disabled={saving || !newLocationName.trim()}><Plus size={15} /> Add location</button>
      </form>
      <div className={styles.locationList}>
        {locations.map(location => <div className={styles.locationRow} key={location.id}>
          {editingLocation?.id === location.id ? <form onSubmit={renameLocation}><input autoFocus maxLength={120} value={editingLocation.name} onChange={event => setEditingLocation({ ...editingLocation, name: event.target.value })} /><button aria-label="Save location name"><Check size={15} /></button><button type="button" onClick={() => setEditingLocation(null)} aria-label="Cancel rename"><X size={15} /></button></form> : <div><strong>{location.name}</strong>{location.isPrimary && <span>Primary</span>}</div>}
          {editingLocation?.id !== location.id && <div className={styles.locationActions}><button onClick={() => setEditingLocation(location)} aria-label={`Rename ${location.name}`} title="Rename"><Pencil size={15} /></button>{!location.isPrimary && <button onClick={() => setPendingArchive(location)} aria-label={`Archive ${location.name}`} title="Archive"><Archive size={15} /></button>}</div>}
        </div>)}
      </div>
      <div className={styles.heading}><Users size={18} /><div><h2>Account team</h2><span>{members.length} active member{members.length === 1 ? '' : 's'}</span></div></div>
      <form className={styles.invite} onSubmit={invite}>
        <UserPlus size={18} />
        <input type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="Approved wholesale email" aria-label="Approved wholesale email" />
        <select value={inviteRole} onChange={event => setInviteRole(event.target.value as 'admin' | 'buyer')} aria-label="Account role">
          <option value="buyer">Buyer</option>
          {role === 'owner' && <option value="admin">Admin</option>}
        </select>
        <button disabled={saving || !email.trim()}>{saving ? 'Adding…' : 'Add member'}</button>
      </form>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {loading ? <div className={styles.empty}>Loading account team…</div> : (
        <div className={styles.memberList}>
          {members.map(member => {
            const removable = !member.isCurrent && (role === 'owner' || (role === 'admin' && member.role === 'buyer'));
            const assignable = !member.isCurrent && (role === 'owner' || member.role === 'buyer');
            return (
              <div className={styles.memberWrap} key={member.id}><div className={styles.member}>
                <div className={styles.identity}><span>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email} · {member.locationName}</small></div></div>
                <div className={styles.memberActions}>
                  {role === 'owner' && !member.isCurrent ? (
                    <select value={member.role} onChange={event => void changeRole(member, event.target.value as WholesaleTeamRole)} aria-label={`Role for ${member.name}`}>
                      <option value="owner">Owner</option><option value="admin">Admin</option><option value="buyer">Buyer</option>
                    </select>
                  ) : <span className={styles.role}><ShieldCheck size={14} /> {member.role}</span>}
                  {removable && <button className={styles.removeButton} onClick={() => setPendingRemove(member)} aria-label={`Remove ${member.name}`} title="Remove member"><Trash2 size={15} /></button>}
                </div>
              </div>{assignable && <div className={styles.assignments}><div>{locations.map(location => <label key={location.id}><input type="checkbox" checked={(assignmentDrafts[member.id] ?? []).includes(location.id)} onChange={() => toggleAssignment(member, location.id)} /> {location.name}</label>)}</div><select value={defaultDrafts[member.id] ?? ''} onChange={event => setDefaultDrafts(previous => ({ ...previous, [member.id]: Number(event.target.value) }))} aria-label={`Default location for ${member.name}`}>{(assignmentDrafts[member.id] ?? []).map(id => { const location = locations.find(item => item.id === id); return location && <option key={id} value={id}>{location.name} (default)</option>; })}</select><button disabled={!(assignmentDrafts[member.id] ?? []).length} onClick={() => void saveAssignments(member)}>Save locations</button></div>}</div>
            );
          })}
        </div>
      )}
      <div className={styles.historyHeading}><History size={16} /><h3>Team history</h3></div>
      <div className={styles.history}>
        {events.length === 0 ? <div className={styles.empty}>No team changes recorded yet.</div> : events.map(event => (
          <div key={event.id}><span><strong>{event.actorName}</strong> {eventLabel(event)}</span><time>{new Date(event.createdAt).toLocaleString('en-AU')}</time></div>
        ))}
      </div>
      {pendingRemove && <div className={styles.confirm} role="alert"><span>Remove <strong>{pendingRemove.name}</strong> from this account?</span><button onClick={() => setPendingRemove(null)}>Cancel</button><button className={styles.confirmRemove} onClick={() => void remove(pendingRemove)}>Remove</button></div>}
      {pendingArchive && <div className={styles.confirm} role="alert"><span>Archive <strong>{pendingArchive.name}</strong>?</span><button onClick={() => setPendingArchive(null)}>Cancel</button><button className={styles.confirmRemove} onClick={() => void archiveLocation(pendingArchive)}>Archive</button></div>}
    </section>
  );
}