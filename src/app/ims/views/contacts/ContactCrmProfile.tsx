'use client';

import { ArrowLeft, Check, ClipboardList, Mail, Pencil, Phone, Plus, Tag, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { isRetailCrmType } from '@/lib/ims/contactCrmAccess';
import type { ContactCrmActivityCategory, ContactCrmTimelineEntry } from '@/lib/ims/contactCrmTimeline';
import { SBDatePicker, type SBDateRange } from '../reports/reportFilterHelpers';
import { ContactCrmTaskEditor, type ContactCrmTaskEditPayload } from './ContactCrmTaskEditor';

type ProfileData = {
  contact: Record<string, any>;
  summaries: Record<string, any>;
  tags: Array<{ id: number; name: string; color?: string | null }>;
};

type TaskRow = {
  id: number;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
};

const CATEGORIES: Array<{ value: ContactCrmActivityCategory; label: string }> = [
  { value: 'sale', label: 'POS' },
  { value: 'order', label: 'Orders' },
  { value: 'credit', label: 'Credit' },
  { value: 'loyalty', label: 'Loyalty' },
  { value: 'interaction', label: 'Interactions' },
  { value: 'task', label: 'Tasks' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 36, border: '1px solid var(--sv-etch)', borderRadius: 6,
  background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '7px 10px',
  fontSize: 13, boxSizing: 'border-box',
};

const commandStyle: React.CSSProperties = {
  minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6,
  background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 10px',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
};

function dateParams(range: SBDateRange) {
  if (range.kind === 'range') return { from: range.from, to: range.to };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Math.max(0, range.window - 1));
  return {
    from: from.toLocaleDateString('sv-SE'),
    to: to.toLocaleDateString('sv-SE'),
  };
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function displayDate(value: unknown, withTime = false) {
  if (!value) return '—';
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-AU', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function ContactCrmProfile({
  contactId,
  isAdvisor,
  onBack,
  onOpenPosSale,
  onOpenSalesOrder,
  onOpenCreditNote,
}: {
  contactId: number;
  isAdvisor: boolean;
  onBack: () => void;
  onOpenPosSale: (id: number) => void;
  onOpenSalesOrder: (id: number) => void;
  onOpenCreditNote: (id: number) => void;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [activity, setActivity] = useState<ContactCrmTimelineEntry[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [assignees, setAssignees] = useState<Array<{ id: number; name: string }>>([]);
  const [tagSuggestions, setTagSuggestions] = useState<Array<{ id: number; name: string }>>([]);
  const [tab, setTab] = useState<'activity' | 'tasks' | 'details'>('activity');
  const [range, setRange] = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });
  const [categories, setCategories] = useState<ContactCrmActivityCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [interactionType, setInteractionType] = useState('note');
  const [interactionBody, setInteractionBody] = useState('');
  const [tagName, setTagName] = useState('');
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '', dueDate: '', priority: 'normal', assignedUserId: '' });
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);

  const loadProfile = useCallback(async () => {
    const [profilePayload, tasksPayload, tagsPayload, assigneePayload] = await Promise.all([
      apiJson(`/api/ims/contacts/${contactId}/crm`),
      apiJson(`/api/ims/contacts/${contactId}/tasks`),
      apiJson(`/api/ims/contacts/${contactId}/tags`),
      apiJson('/api/ims/contacts/assignees'),
    ]);
    setProfile(profilePayload.data);
    if (!isRetailCrmType(profilePayload.data?.contact?.type)) {
      setCategories(current => current.filter(category => category !== 'sale' && category !== 'loyalty'));
    }
    setTasks(tasksPayload.data ?? []);
    setTagSuggestions(tagsPayload.data?.suggestions ?? []);
    setAssignees(assigneePayload.data ?? []);
  }, [contactId]);

  const loadActivity = useCallback(async () => {
    const dates = dateParams(range);
    const query = new URLSearchParams({ ...dates, limit: '100' });
    if (categories.length) query.set('categories', categories.join(','));
    const payload = await apiJson(`/api/ims/contacts/${contactId}/activity?${query}`);
    setActivity(payload.data?.entries ?? []);
  }, [categories, contactId, range]);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([loadProfile(), loadActivity()])
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Customer profile could not be loaded.'))
      .finally(() => setLoading(false));
  }, [loadActivity, loadProfile]);

  const refreshAfterWrite = async () => {
    await Promise.all([loadProfile(), loadActivity()]);
  };

  const submitInteraction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!interactionBody.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/ims/contacts/${contactId}/interactions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionType, body: interactionBody }),
      });
      setInteractionBody('');
      await refreshAfterWrite();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Interaction could not be saved.');
    } finally { setBusy(false); }
  };

  const submitTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskDraft.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/ims/contacts/${contactId}/tasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...taskDraft, assignedUserId: taskDraft.assignedUserId || null }),
      });
      setTaskDraft({ title: '', description: '', dueDate: '', priority: 'normal', assignedUserId: '' });
      await refreshAfterWrite();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task could not be saved.');
    } finally { setBusy(false); }
  };

  const setTaskStatus = async (taskId: number, status: 'open' | 'completed' | 'cancelled') => {
    setBusy(true);
    try {
      await apiJson(`/api/ims/contacts/${contactId}/tasks/${taskId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      await refreshAfterWrite();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task could not be updated.');
    } finally { setBusy(false); }
  };

  const saveTask = async (payload: ContactCrmTaskEditPayload) => {
    if (!editingTask) return;
    setBusy(true);
    setError('');
    try {
      await apiJson(`/api/ims/contacts/${contactId}/tasks/${editingTask.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      setEditingTask(null);
      await refreshAfterWrite();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task could not be updated.');
    } finally { setBusy(false); }
  };

  const addTag = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tagName.trim()) return;
    setBusy(true);
    try {
      await apiJson(`/api/ims/contacts/${contactId}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tagName }),
      });
      setTagName('');
      await loadProfile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tag could not be added.');
    } finally { setBusy(false); }
  };

  const removeTag = async (tagId: number) => {
    setBusy(true);
    try {
      await apiJson(`/api/ims/contacts/${contactId}/tags?tagId=${tagId}`, { method: 'DELETE' });
      await loadProfile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tag could not be removed.');
    } finally { setBusy(false); }
  };

  const openSource = (entry: ContactCrmTimelineEntry) => {
    if (!entry.source) return;
    if (entry.source.type === 'pos_sale') onOpenPosSale(entry.source.id);
    if (entry.source.type === 'sales_order') onOpenSalesOrder(entry.source.id);
    if (entry.source.type === 'credit_note') onOpenCreditNote(entry.source.id);
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--sv-text-dim)' }}>Loading customer profile…</div>;
  if (!profile) return (
    <div style={{ padding: 24 }}>
      <button onClick={onBack} style={commandStyle}><ArrowLeft size={15} /> Back to Contacts</button>
      <p style={{ color: 'var(--sv-red)', marginTop: 20 }}>{error || 'Customer not found.'}</p>
    </div>
  );

  const contact = profile.contact;
  const isRetailCustomer = isRetailCrmType(contact.type);
  const visibleActivity = activity.filter(entry => isRetailCustomer || (entry.category !== 'sale' && entry.category !== 'loyalty'));
  const openTasks = tasks.filter(task => task.status === 'open');
  const closedTasks = tasks.filter(task => task.status !== 'open');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, paddingBottom: 18, borderBottom: '1px solid var(--sv-etch)' }}>
        <button onClick={onBack} title="Back to Contacts" style={{ ...commandStyle, padding: 8 }}><ArrowLeft size={17} /></button>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 23, color: 'var(--sv-text-strong)' }}>{contact.name}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 4, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)' }}>{String(contact.type).replaceAll('_', ' ')}</span>
            {!contact.is_active && <span style={{ fontSize: 11, color: 'var(--sv-red)', fontWeight: 700 }}>Inactive</span>}
          </div>
          {contact.company && <div style={{ marginTop: 3, fontSize: 13, color: 'var(--sv-text-dim)' }}>{contact.company}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 9, fontSize: 12, color: 'var(--sv-text-main)' }}>
            {contact.email && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Mail size={13} /> {contact.email}</span>}
            {(contact.mobile || contact.phone) && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Phone size={13} /> {contact.mobile || contact.phone}</span>}
            {contact.customer_code && <span>{contact.customer_code}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
          {profile.tags.map(item => (
            <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 27, padding: '3px 7px', borderRadius: 5, background: 'color-mix(in srgb, var(--sv-action) 10%, var(--sv-bg-1))', color: 'var(--sv-action)', fontSize: 11, fontWeight: 700 }}>
              <Tag size={11} /> {item.name}
              {!isAdvisor && <button onClick={() => removeTag(item.id)} disabled={busy} title={`Remove ${item.name}`} style={{ border: 0, background: 'none', color: 'inherit', padding: 0, cursor: 'pointer', display: 'flex' }}><X size={12} /></button>}
            </span>
          ))}
          {!isAdvisor && (
            <form onSubmit={addTag} style={{ display: 'flex', gap: 5 }}>
              <input list="crm-tag-suggestions" value={tagName} onChange={event => setTagName(event.target.value)} placeholder="Add tag" style={{ ...inputStyle, width: 120, minHeight: 28, padding: '3px 7px' }} />
              <datalist id="crm-tag-suggestions">{tagSuggestions.map(item => <option key={item.id} value={item.name} />)}</datalist>
              <button disabled={busy || !tagName.trim()} title="Add tag" style={{ ...commandStyle, minHeight: 28, padding: 5 }}><Plus size={14} /></button>
            </form>
          )}
        </div>
      </header>

      {error && <div role="alert" style={{ padding: '9px 12px', borderLeft: '3px solid var(--sv-red)', background: 'var(--sv-red-tint)', color: 'var(--sv-red)', fontSize: 12 }}>{error}</div>}

      <section aria-label="Customer commercial summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {[
          ...(isRetailCustomer ? [['POS net', money(profile.summaries.pos?.net_total), `${Number(profile.summaries.pos?.transaction_count ?? 0)} transactions`]] : []),
          ['Sales orders', money(profile.summaries.salesOrders?.order_total), `${Number(profile.summaries.salesOrders?.order_count ?? 0)} orders`],
          ['Customer credits', money(profile.summaries.creditNotes?.credit_total), `${Number(profile.summaries.creditNotes?.credit_count ?? 0)} records`],
          ['Store credit', money(profile.summaries.storeCredit), 'Read-only balance'],
          ...(isRetailCustomer ? [['Loyalty', `${Number(profile.summaries.loyalty?.balance_points ?? 0).toLocaleString()} pts`, profile.summaries.loyalty ? 'Current balance' : 'No account']] : []),
          ['Follow-ups', String(openTasks.length), `${Number(profile.summaries.tasks?.overdue_count ?? 0)} overdue`],
        ].map(([label, value, hint]) => (
          <div key={label} style={{ border: '1px solid var(--sv-etch)', borderRadius: 7, padding: '11px 12px', minHeight: 72, background: 'var(--sv-bg-1)' }}>
            <div style={{ fontSize: 10, color: 'var(--sv-text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
            <div style={{ marginTop: 5, fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{value}</div>
            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--sv-text-dim)' }}>{hint}{label !== 'Loyalty' && label !== 'Follow-ups' ? ' · Tax-inclusive' : ''}</div>
          </div>
        ))}
      </section>

      <nav aria-label="Customer profile sections" style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--sv-etch)' }}>
        {(['activity', 'tasks', 'details'] as const).map(item => (
          <button key={item} onClick={() => setTab(item)} style={{ border: 0, borderBottom: tab === item ? '2px solid var(--sv-action)' : '2px solid transparent', background: 'none', color: tab === item ? 'var(--sv-action)' : 'var(--sv-text-dim)', padding: '9px 12px', fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize' }}>
            {item}{item === 'tasks' && openTasks.length ? ` (${openTasks.length})` : ''}
          </button>
        ))}
      </nav>

      {tab === 'activity' && (
        <section>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <SBDatePicker value={range} onChange={setRange} />
            {CATEGORIES.filter(item => isRetailCustomer || (item.value !== 'sale' && item.value !== 'loyalty')).map(item => {
              const active = categories.includes(item.value);
              return <button key={item.value} onClick={() => setCategories(current => active ? current.filter(value => value !== item.value) : [...current, item.value])} style={{ ...commandStyle, minHeight: 34, background: active ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: active ? '#fff' : 'var(--sv-text-main)' }}>{item.label}</button>;
            })}
          </div>
          {!isAdvisor && (
            <form onSubmit={submitInteraction} style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'start', paddingBottom: 15, borderBottom: '1px solid var(--sv-etch)' }}>
              <select value={interactionType} onChange={event => setInteractionType(event.target.value)} style={{ ...inputStyle, width: 120, flex: '0 1 120px' }}>
                <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="other">Other</option>
              </select>
              <textarea value={interactionBody} onChange={event => setInteractionBody(event.target.value)} placeholder="Record an interaction…" rows={2} style={{ ...inputStyle, resize: 'vertical', flex: '1 1 220px' }} />
              <button disabled={busy || !interactionBody.trim()} style={{ ...commandStyle, background: 'var(--sv-action)', color: '#fff' }}><Plus size={14} /> Add</button>
            </form>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visibleActivity.length === 0 && <div style={{ padding: '26px 4px', color: 'var(--sv-text-dim)', fontSize: 13 }}>No activity in this period.</div>}
            {visibleActivity.map(entry => (
              <article key={entry.entryKey} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr) auto', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--sv-etch)', alignItems: 'start' }}>
                <time style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{displayDate(entry.occurredAt, true)}</time>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, color: 'var(--sv-text-strong)' }}>{entry.title}</strong>
                    {entry.status && <span style={{ fontSize: 10, color: 'var(--sv-text-dim)', textTransform: 'capitalize' }}>{entry.status.replaceAll('_', ' ')}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.summary}</div>
                  {entry.actorName && <div style={{ fontSize: 10, color: 'var(--sv-text-dim)', marginTop: 4 }}>By {entry.actorName}</div>}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {entry.amount != null && <div style={{ fontWeight: 700, color: entry.amount < 0 ? 'var(--sv-red)' : 'var(--sv-text-strong)', fontSize: 13 }}>{money(entry.amount)}</div>}
                  {entry.points != null && <div style={{ fontWeight: 700, color: entry.points < 0 ? 'var(--sv-red)' : 'var(--sv-mint)', fontSize: 12 }}>{entry.points > 0 ? '+' : ''}{entry.points} pts</div>}
                  {entry.source && <button onClick={() => openSource(entry)} style={{ ...commandStyle, minHeight: 26, padding: '3px 7px', marginTop: 5 }}>Open</button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'tasks' && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 22, alignItems: 'start' }}>
          <div>
            <h2 style={{ fontSize: 15, margin: '0 0 9px', color: 'var(--sv-text-strong)' }}>Open follow-ups</h2>
            {!openTasks.length && <p style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>No open tasks.</p>}
            {[...openTasks, ...closedTasks].map(task => {
              const overdue = task.status === 'open' && task.due_date && task.due_date < new Date().toLocaleDateString('sv-SE');
              return (
                <div key={task.id} style={{ padding: '11px 0', borderBottom: '1px solid var(--sv-etch)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <ClipboardList size={16} style={{ marginTop: 2, color: overdue ? 'var(--sv-red)' : 'var(--sv-action)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 13, color: task.status === 'open' ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>{task.title}</strong>
                    {task.description && <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 3 }}>{task.description}</div>}
                    <div style={{ fontSize: 10, color: overdue ? 'var(--sv-red)' : 'var(--sv-text-dim)', marginTop: 5 }}>
                      {task.due_date ? `${overdue ? 'Overdue · ' : 'Due '}${displayDate(task.due_date)}` : 'No due date'}
                      {task.assigned_user_name ? ` · ${task.assigned_user_name}` : ' · Unassigned'} · {task.priority}
                    </div>
                  </div>
                  {!isAdvisor && <button disabled={busy} onClick={() => setEditingTask(task)} title="Edit task" style={{ ...commandStyle, padding: 6 }}><Pencil size={14} /></button>}
                  {!isAdvisor && task.status === 'open' && <>
                    <button disabled={busy} onClick={() => setTaskStatus(task.id, 'completed')} title="Complete task" style={{ ...commandStyle, padding: 6 }}><Check size={14} /></button>
                    <button disabled={busy} onClick={() => setTaskStatus(task.id, 'cancelled')} title="Cancel task" style={{ ...commandStyle, padding: 6 }}><X size={14} /></button>
                  </>}
                  {!isAdvisor && task.status !== 'open' && <button disabled={busy} onClick={() => setTaskStatus(task.id, 'open')} style={commandStyle}>Reopen</button>}
                </div>
              );
            })}
          </div>
          {!isAdvisor && (
            <form onSubmit={submitTask} style={{ borderLeft: '1px solid var(--sv-etch)', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <h2 style={{ fontSize: 15, margin: 0, color: 'var(--sv-text-strong)' }}>New follow-up</h2>
              <input value={taskDraft.title} onChange={event => setTaskDraft(current => ({ ...current, title: event.target.value }))} placeholder="Task title" style={inputStyle} />
              <textarea value={taskDraft.description} onChange={event => setTaskDraft(current => ({ ...current, description: event.target.value }))} placeholder="Details (optional)" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
              <input type="date" value={taskDraft.dueDate} onChange={event => setTaskDraft(current => ({ ...current, dueDate: event.target.value }))} style={inputStyle} />
              <select value={taskDraft.priority} onChange={event => setTaskDraft(current => ({ ...current, priority: event.target.value }))} style={inputStyle}>
                <option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option>
              </select>
              <select value={taskDraft.assignedUserId} onChange={event => setTaskDraft(current => ({ ...current, assignedUserId: event.target.value }))} style={inputStyle}>
                <option value="">Unassigned</option>{assignees.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <button disabled={busy || !taskDraft.title.trim()} style={{ ...commandStyle, justifyContent: 'center', background: 'var(--sv-action)', color: '#fff' }}><Plus size={14} /> Create task</button>
            </form>
          )}
        </section>
      )}

      {tab === 'details' && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', columnGap: 28, rowGap: 14 }}>
          {[
            ['Email', contact.email], ['Phone', contact.phone], ['Mobile', contact.mobile],
            ['Customer group', contact.customer_group], ['Price tier', contact.price_tier],
            ['Address', [contact.address, contact.address2, contact.suburb || contact.city, contact.state, contact.postcode].filter(Boolean).join(', ')],
            ['Date of birth', displayDate(contact.date_of_birth)], ['Email marketing', contact.promo_email ? 'Opted in' : 'Not opted in'],
            ['SMS marketing', contact.promo_sms ? 'Opted in' : 'Not opted in'],
            ...(isRetailCustomer ? [['Loyalty member', contact.loyalty_member ? 'Enrolled' : 'Not enrolled']] : []),
          ].map(([label, value]) => (
            <div key={label} style={{ paddingBottom: 10, borderBottom: '1px solid var(--sv-etch)' }}>
              <div style={{ fontSize: 10, color: 'var(--sv-text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--sv-text-main)', overflowWrap: 'anywhere' }}>{value || '—'}</div>
            </div>
          ))}
        </section>
      )}

      {editingTask && <ContactCrmTaskEditor task={editingTask} assignees={assignees} saving={busy} onClose={() => setEditingTask(null)} onSave={saveTask} />}
    </div>
  );
}