'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { History, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import type { WholesaleTeamRole } from '@/lib/wholesale/wholesaleTeam';
import styles from './WholesaleTeamSection.module.css';

type TeamMember = {
  id: number; name: string; email: string; role: WholesaleTeamRole;
  locationName: string; isCurrent: boolean;
};
type TeamEvent = {
  id: number; actorName: string; targetName: string; targetEmail: string;
  action: string; beforeRole: string | null; afterRole: string | null; createdAt: string;
};

function eventLabel(event: TeamEvent) {
  if (event.action === 'access_granted') return `added ${event.targetName} as ${event.afterRole}`;
  if (event.action === 'role_changed') return `changed ${event.targetName} from ${event.beforeRole} to ${event.afterRole}`;
  if (event.action === 'access_removed') return `removed ${event.targetName}`;
  return `updated ${event.targetName}`;
}

export function WholesaleTeamSection({ role }: { role: WholesaleTeamRole }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'buyer'>('buyer');
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/account/team');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Account team could not be loaded.');
      setMembers(body.members ?? []);
      setEvents(body.events ?? []);
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

  return (
    <section className={styles.section}>
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
            return (
              <div className={styles.member} key={member.id}>
                <div className={styles.identity}><span>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email} · {member.locationName}</small></div></div>
                <div className={styles.memberActions}>
                  {role === 'owner' && !member.isCurrent ? (
                    <select value={member.role} onChange={event => void changeRole(member, event.target.value as WholesaleTeamRole)} aria-label={`Role for ${member.name}`}>
                      <option value="owner">Owner</option><option value="admin">Admin</option><option value="buyer">Buyer</option>
                    </select>
                  ) : <span className={styles.role}><ShieldCheck size={14} /> {member.role}</span>}
                  {removable && <button className={styles.removeButton} onClick={() => setPendingRemove(member)} aria-label={`Remove ${member.name}`} title="Remove member"><Trash2 size={15} /></button>}
                </div>
              </div>
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
    </section>
  );
}