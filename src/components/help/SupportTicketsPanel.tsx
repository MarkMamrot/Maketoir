'use client';

import { useCallback, useEffect, useState } from 'react';

export interface SupportTicket {
  id: number;
  business_id: string | null;
  business_name: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  source_app: 'ims' | 'pos';
  screen_context: string | null;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assigned_to: number | null;
  assigned_name: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const panel = { background: 'var(--sv-bg-1,#1e293b)', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 8 };
const input = { padding: '8px 10px', background: 'var(--sv-bg-2,#334155)', border: '1px solid var(--sv-etch,rgba(255,255,255,.15))', borderRadius: 6, color: 'var(--sv-text-main,#e2e8f0)', fontSize: 12 };
const drawerSurface = '#0f172a';
const drawerPanel = { background: '#172033', border: '1px solid #334155', borderRadius: 8 };
const drawerInput = { padding: '9px 11px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a', fontSize: 12 };

function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusColor(status: SupportTicket['status'], onDark: boolean) {
  if (onDark) return status === 'open' ? '#fb7185' : status === 'in_progress' ? '#fbbf24' : status === 'resolved' ? '#38bdf8' : '#cbd5e1';
  return status === 'open' ? '#be123c' : status === 'in_progress' ? '#a16207' : status === 'resolved' ? '#0369a1' : '#475569';
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Shared ticket list/detail UI used by both the Admin section and the Super Admin Team Communications tab. */
export function SupportTicketsPanel({ showSettings = false, onOpenCountChange }: { showSettings?: boolean; onOpenCountChange?: (count: number) => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [businesses, setBusinesses] = useState<Array<{ business_id: string; name: string }>>([]);
  const [assignableUsers, setAssignableUsers] = useState<Array<{ id: number; name: string }>>([]);
  const [status, setStatus] = useState('open');
  const [businessId, setBusinessId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ limit: '200' });
    if (status) params.set('status', status);
    if (businessId) params.set('businessId', businessId);
    if (search.trim()) params.set('search', search.trim());
    try {
      const response = await fetch(`/api/admin/support-tickets?${params}`);
      const data = await responseJson(response);
      if (!response.ok || !data) {
        setLoadError(data?.error ?? 'Support tickets could not be loaded.');
        return;
      }
      setTickets(data.tickets ?? []);
      setSummary(data.summary ?? {});
      setBusinesses(data.businesses ?? []);
      const openCount = (data.summary?.open ?? 0) + (data.summary?.in_progress ?? 0);
      onOpenCountChange?.(openCount);
    } catch {
      setLoadError('Support tickets could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [businessId, search, status, onOpenCountChange]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetch('/api/admin/support-tickets/assignable-users')
      .then(responseJson)
      .then(data => setAssignableUsers(data?.users ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    fetch('/api/admin/support-tickets/settings')
      .then(responseJson)
      .then(data => setNotificationEmail(data?.notificationEmail ?? ''))
      .catch(() => {});
  }, [showSettings]);

  const saveNotificationEmail = async () => {
    setSavingEmail(true);
    await fetch('/api/admin/support-tickets/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationEmail }),
    });
    setSavingEmail(false);
  };

  const openTicket = async (id: number) => {
    const response = await fetch(`/api/admin/support-tickets/${id}`);
    const data = await responseJson(response);
    if (response.ok && data?.ticket) {
      setSelected(data.ticket);
      setNotes(data.ticket.resolution_notes ?? '');
      setAssignedTo(data.ticket.assigned_to ?? null);
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const response = await fetch(`/api/admin/support-tickets/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: selected.status, assignedTo, resolutionNotes: notes }),
    });
    setSaving(false);
    if (response.ok) {
      setSelected(null);
      await load();
    }
  };

  return (
    <div>
      {showSettings && (
        <div style={{ ...panel, padding: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--sv-text-dim,#94a3b8)', whiteSpace: 'nowrap' }}>Notification email</label>
          <input aria-label="Support ticket notification email" value={notificationEmail} onChange={event => setNotificationEmail(event.target.value)} placeholder="e.g. support@solvantis.com.au" style={{ ...input, flex: 1 }} />
          <button onClick={() => void saveNotificationEmail()} disabled={savingEmail} style={{ ...input, cursor: 'pointer', fontWeight: 700 }}>{savingEmail ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Support Tickets</h1>
          <p style={{ margin: '5px 0 0', color: '#94a3b8', fontSize: 12 }}>Requests raised from Help in IMS and POS, across all businesses.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['open', 'in_progress', 'resolved', 'closed'] as const).map(item => (
            <button key={item} onClick={() => setStatus(item)} style={{ ...panel, padding: '8px 12px', cursor: 'pointer', color: status === item ? '#fff' : '#94a3b8', background: status === item ? '#2563eb' : panel.background, fontSize: 12, fontWeight: 700 }}>
              {item === 'in_progress' ? 'In progress' : item[0].toUpperCase() + item.slice(1)} · {summary[item] ?? 0}
            </button>
          ))}
          <button onClick={() => setStatus('')} style={{ ...panel, padding: '8px 12px', cursor: 'pointer', color: status === '' ? '#fff' : '#94a3b8', background: status === '' ? '#2563eb' : panel.background, fontSize: 12 }}>All</button>
        </div>
      </div>

      <div style={{ ...panel, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 200px auto', gap: 8, marginBottom: 12 }}>
        <input aria-label="Search tickets" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search subject, description" style={input} />
        <select aria-label="Business" value={businessId} onChange={event => setBusinessId(event.target.value)} style={input}>
          <option value="">All businesses</option>
          {businesses.map(business => <option key={business.business_id} value={business.business_id}>{business.name}</option>)}
        </select>
        <button onClick={() => void load()} style={{ ...input, cursor: 'pointer', fontWeight: 700 }}>Refresh</button>
      </div>

      <div style={{ ...panel, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px minmax(140px,1fr) minmax(240px,2fr) 130px 150px', padding: '9px 12px', background: '#334155', color: '#e2e8f0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
          <span>Status</span><span>Business</span><span>Subject</span><span>Assigned</span><span>Created</span>
        </div>
        {loading ? <p style={{ padding: 24, color: '#94a3b8' }}>Loading…</p> : loadError ? <p style={{ padding: 24, color: '#fca5a5' }}>{loadError}</p> : tickets.length === 0 ? <p style={{ padding: 24, color: '#94a3b8' }}>No matching support tickets.</p> : tickets.map(ticket => (
          <button key={ticket.id} onClick={() => void openTicket(ticket.id)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '90px minmax(140px,1fr) minmax(240px,2fr) 130px 150px', alignItems: 'center', padding: '11px 12px', border: 0, borderTop: '1px solid var(--sv-etch,#e2e8f0)', background: 'transparent', color: 'var(--sv-text-main,#475569)', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>
            <span style={{ color: statusColor(ticket.status, false), fontWeight: 800, textTransform: 'uppercase', fontSize: 10 }}>{ticket.status.replace('_', ' ')}</span>
            <span>{ticket.business_name}</span>
            <span><strong style={{ color: 'var(--sv-text-strong,#0f172a)' }}>{ticket.subject}</strong><br /><small style={{ color: 'var(--sv-text-dim,#64748b)' }}>{ticket.source_app.toUpperCase()}{ticket.screen_context ? ` · ${ticket.screen_context}` : ''}</small></span>
            <span>{ticket.assigned_name ?? '—'}</span>
            <span>{dateTime(ticket.created_at)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.72)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}>
          <aside aria-label="Support ticket details" className="support-ticket-details" style={{ width: 'min(680px, 100vw)', height: '100dvh', overflowY: 'auto', boxSizing: 'border-box', background: drawerSurface, borderLeft: '1px solid #334155', color: '#e2e8f0', boxShadow: '-20px 0 50px rgba(2,6,23,.28)' }} onClick={event => event.stopPropagation()}>
            <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 20px', background: 'rgba(15,23,42,.97)', borderBottom: '1px solid #334155' }}>
              <p style={{ margin: 0, color: statusColor(selected.status, true), textTransform: 'uppercase', fontSize: 10, fontWeight: 800 }}>{selected.status.replace('_', ' ')} · {selected.business_name}</p>
              <button aria-label="Close ticket" title="Close" onClick={() => setSelected(null)} style={{ width: 34, height: 34, border: '1px solid #475569', borderRadius: 6, background: '#1e293b', color: '#f8fafc', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '20px clamp(16px, 4vw, 28px) 32px' }}>
              <h2 style={{ margin: '0 0 8px', color: '#f8fafc', fontSize: 20, lineHeight: 1.3 }}>{selected.subject}</h2>
              <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.55, fontSize: 13, whiteSpace: 'pre-wrap' }}>{selected.description}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, ...drawerPanel, padding: 14, margin: '18px 0' }}>
                <div><p style={{ margin: 0, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Submitted by</p><p style={{ margin: '3px 0 0', fontSize: 13 }}>{selected.submitted_by_name ?? 'Unknown'}</p></div>
                <div><p style={{ margin: 0, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>App</p><p style={{ margin: '3px 0 0', fontSize: 13 }}>{selected.source_app.toUpperCase()}{selected.screen_context ? ` · ${selected.screen_context}` : ''}</p></div>
                <div><p style={{ margin: 0, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Created</p><p style={{ margin: '3px 0 0', fontSize: 13 }}>{dateTime(selected.created_at)}</p></div>
              </div>

              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Status</label>
              <select aria-label="Status" value={selected.status} onChange={event => setSelected({ ...selected, status: event.target.value as SupportTicket['status'] })} style={{ ...drawerInput, width: '100%', marginBottom: 12 }}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Assigned to</label>
              <select aria-label="Assigned to" value={assignedTo ?? ''} onChange={event => setAssignedTo(event.target.value ? Number(event.target.value) : null)} style={{ ...drawerInput, width: '100%', marginBottom: 12 }}>
                <option value="">Unassigned</option>
                {assignableUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>

              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Resolution notes</label>
              <textarea aria-label="Resolution notes" value={notes} onChange={event => setNotes(event.target.value)} rows={4} style={{ ...drawerInput, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 16 }} />

              <button onClick={() => void save()} disabled={saving} style={{ ...drawerInput, background: '#2563eb', color: '#fff', border: 0, fontWeight: 700, cursor: 'pointer', padding: '10px 16px' }}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
