'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, RotateCw } from 'lucide-react';

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
  images?: Array<{ filename: string; url: string }>;
  updates?: Array<{ id: number; author_name: string; message: string; status: SupportTicket['status']; email_status: 'pending' | 'sent' | 'failed' | 'no_email'; created_at: string }>;
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
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
      setNotes('');
      setSaveError(null);
      setAssignedTo(data.ticket.assigned_to ?? null);
    }
  };

  const save = async (retryUpdateId?: number) => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    const key = JSON.stringify({ id: selected.id, status: selected.status, assignedTo, message: notes });
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/admin/support-tickets/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: selected.status, assignedTo, message: notes, requestId: requestRef.current.id, retryUpdateId }),
      });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(data?.error ?? 'Update could not be saved.');
      const detail = await fetch(`/api/admin/support-tickets/${selected.id}`);
      const result = await responseJson(detail);
      if (!detail.ok || !result?.ticket) throw new Error('Update saved, but the history could not reload. Reopen the ticket to check it.');
      setSelected(result.ticket);
      if (!retryUpdateId) { setNotes(''); requestRef.current = null; }
      if (data?.emailStatus === 'failed') setSaveError('Update saved, but its email failed. Retry email from the update below.');
      if (data?.emailStatus === 'no_email') setSaveError('Update saved. This older ticket has no submitter email address, so no email could be sent.');
      await load();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Update could not be saved. Please retry.');
    } finally {
      setSaving(false);
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
            <span><strong style={{ color: 'var(--sv-text-strong,#0f172a)' }}>#{ticket.id} · {ticket.subject}</strong><br /><small style={{ color: 'var(--sv-text-dim,#64748b)' }}>{ticket.source_app.toUpperCase()}{ticket.screen_context ? ` · ${ticket.screen_context}` : ''}</small></span>
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
              <h2 style={{ margin: '0 0 8px', color: '#f8fafc', fontSize: 20, lineHeight: 1.3, overflowWrap: 'anywhere' }}>#{selected.id} · {selected.subject}</h2>
              <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.55, fontSize: 13, whiteSpace: 'pre-wrap' }}>{selected.description}</p>
              {Boolean(selected.images?.length) && <section aria-label="Ticket images" style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 13 }}>Images</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                  {selected.images?.map((image, index) => <a key={image.filename} href={image.url} target="_blank" rel="noopener noreferrer" title={`Open image ${index + 1}`}>
                    <img src={image.url} alt={`Ticket attachment ${index + 1}`} style={{ width: '100%', height: 160, objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
                  </a>)}
                </div>
              </section>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, ...drawerPanel, padding: 14, margin: '18px 0' }}>
                <div><p style={{ margin: 0, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Submitted by</p><p style={{ margin: '3px 0 0', fontSize: 13 }}>{selected.submitted_by_name ?? 'Unknown'}</p></div>
                <div style={{ overflowWrap: 'anywhere' }}><p style={{ margin: 0, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>Reply email</p><p style={{ margin: '3px 0 0', fontSize: 13 }}>{selected.submitted_by_email ?? 'Not recorded'}</p></div>
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

              <section aria-label="Ticket updates" style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 14 }}>Updates</h3>
                {selected.resolution_notes && <div style={{ borderBottom: '1px solid #334155', paddingBottom: 12 }}><p style={{ fontSize: 11, color: '#94a3b8' }}>Previous resolution notes</p><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{selected.resolution_notes}</p></div>}
                {selected.updates?.map(update => <div key={update.id} style={{ borderBottom: '1px solid #334155', padding: '12px 0' }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', overflowWrap: 'anywhere' }}>{update.author_name} · {dateTime(update.created_at)}</p>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{update.message}</p>
                  <span style={{ fontSize: 11, color: update.email_status === 'failed' ? '#fca5a5' : '#cbd5e1' }}>{update.email_status === 'sent' ? 'Email sent' : update.email_status === 'no_email' ? 'No reply email recorded' : update.email_status === 'failed' ? 'Email failed' : 'Email pending'}</span>
                  {(update.email_status === 'failed' || update.email_status === 'pending') && <button title="Retry email" aria-label={`Retry email for update ${update.id}`} disabled={saving} onClick={() => void save(update.id)} style={{ ...drawerInput, marginLeft: 8, cursor: 'pointer' }}><RotateCw size={14} /></button>}
                </div>)}
              </section>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>New update</label>
              <textarea aria-label="New update" maxLength={10_000} disabled={saving} value={notes} onChange={event => setNotes(event.target.value)} rows={4} style={{ ...drawerInput, width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 16 }} />
              {saveError && <p role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>{saveError}</p>}
              <button onClick={() => void save()} disabled={saving} style={{ ...drawerInput, background: '#2563eb', color: '#fff', border: 0, fontWeight: 700, cursor: 'pointer', padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}><Send size={15} />{saving ? 'Saving…' : notes.trim() ? 'Post update' : 'Save changes'}</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
