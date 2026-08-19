'use client';

import { Download, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { ContactCrmSegmentRules } from '@/lib/ims/contactCrmGrowthService';

type TagOption = { id: number; name: string };
type Segment = { id: number; name: string; description?: string | null; rules: ContactCrmSegmentRules; updated_at: string };
type Member = { id: number; name: string; company?: string | null; type: string; email?: string | null; revenue: number; last_activity_at?: string | null };
type LocationOption = { id: number; name: string };

const blankRules: ContactCrmSegmentRules = {
  contactTypes: [], tagIds: [], revenueSource: 'combined', minimumRevenue: null, maximumRevenue: null,
  activeWithinDays: null, inactiveForDays: null, locationIds: [], loyaltyStatus: 'all',
};
const fieldStyle: React.CSSProperties = { minHeight: 36, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '7px 9px', fontSize: 12 };
const buttonStyle: React.CSSProperties = { minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' };

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function ContactCrmSegments({ tags, isAdvisor, onOpenProfile }: { tags: TagOption[]; isAdvisor: boolean; onOpenProfile: (id: number) => void }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [editing, setEditing] = useState<Segment | null | 'new'>(null);
  const [draft, setDraft] = useState({ name: '', description: '', rules: { ...blankRules } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadSegments = async () => {
    const [segmentPayload, locationPayload] = await Promise.all([
      apiJson('/api/ims/contacts/segments'),
      apiJson('/api/ims/locations').catch(() => ({ data: [] })),
    ]);
    setSegments(segmentPayload.data ?? []);
    setLocations(Array.isArray(locationPayload.data) ? locationPayload.data : []);
  };
  const evaluate = async (id: number) => {
    setBusy(true); setError('');
    try {
      const payload = await apiJson(`/api/ims/contacts/segments/${id}`);
      setSelectedId(id); setMembers(payload.data?.members ?? []); setTruncated(Boolean(payload.data?.truncated));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Segment could not be evaluated.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void loadSegments().catch(cause => setError(cause.message)); }, []);

  const openEditor = (segment?: Segment) => {
    setEditing(segment ?? 'new');
    setDraft(segment ? { name: segment.name, description: segment.description ?? '', rules: { ...segment.rules } } : { name: '', description: '', rules: { ...blankRules } });
  };
  const setRule = (key: keyof ContactCrmSegmentRules, value: ContactCrmSegmentRules[keyof ContactCrmSegmentRules]) => setDraft(current => ({ ...current, rules: { ...current.rules, [key]: value } }));
  const toggleArray = (key: 'contactTypes' | 'tagIds' | 'locationIds', value: string | number) => {
    const current = draft.rules[key] as Array<string | number>;
    setRule(key, (current.includes(value) ? current.filter(item => item !== value) : [...current, value]) as never);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const isNew = editing === 'new';
      await apiJson(isNew ? '/api/ims/contacts/segments' : `/api/ims/contacts/segments/${(editing as Segment).id}`, {
        method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      });
      setEditing(null); await loadSegments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Segment could not be saved.'); }
    finally { setBusy(false); }
  };
  const remove = async (segment: Segment) => {
    if (!confirm(`Delete segment “${segment.name}”?`)) return;
    setBusy(true);
    try { await apiJson(`/api/ims/contacts/segments/${segment.id}`, { method: 'DELETE' }); if (selectedId === segment.id) { setSelectedId(null); setMembers([]); } await loadSegments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Segment could not be deleted.'); }
    finally { setBusy(false); }
  };
  const exportCsv = () => {
    const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Company', 'Type', 'Email', 'Revenue', 'Last activity'], ...members.map(item => [item.name, item.company, item.type, item.email, item.revenue, item.last_activity_at])];
    const blob = new Blob([rows.map(row => row.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'crm-segment.csv'; link.click(); URL.revokeObjectURL(url);
  };

  return <div style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 220 }}><strong style={{ color: 'var(--sv-text-strong)' }}>Live customer segments</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 2 }}>Membership recalculates from current customer and commerce data.</div></div>
      {!isAdvisor && <button onClick={() => openEditor()} style={{ ...buttonStyle, background: 'var(--sv-action)', color: '#fff' }}><Plus size={14} /> New segment</button>}
    </div>
    {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
    {editing && <form onSubmit={save} style={{ borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)', padding: '14px 0', marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 9 }}>
        <input required value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="Segment name" style={fieldStyle} />
        <input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="Description" style={fieldStyle} />
        <select value={draft.rules.revenueSource} onChange={event => setRule('revenueSource', event.target.value as any)} style={fieldStyle}><option value="combined">POS + sales orders</option><option value="pos">POS only</option><option value="sales_orders">Sales orders only</option></select>
        <input type="number" min="0" step="0.01" value={draft.rules.minimumRevenue ?? ''} onChange={event => setRule('minimumRevenue', event.target.value === '' ? null : Number(event.target.value))} placeholder="Minimum revenue" style={fieldStyle} />
        <input type="number" min="0" step="0.01" value={draft.rules.maximumRevenue ?? ''} onChange={event => setRule('maximumRevenue', event.target.value === '' ? null : Number(event.target.value))} placeholder="Maximum revenue" style={fieldStyle} />
        <input type="number" min="1" value={draft.rules.activeWithinDays ?? ''} onChange={event => { setRule('activeWithinDays', event.target.value === '' ? null : Number(event.target.value)); setRule('inactiveForDays', null); }} placeholder="Active within days" style={fieldStyle} />
        <input type="number" min="1" value={draft.rules.inactiveForDays ?? ''} onChange={event => { setRule('inactiveForDays', event.target.value === '' ? null : Number(event.target.value)); setRule('activeWithinDays', null); }} placeholder="Inactive for days" style={fieldStyle} />
        <select value={draft.rules.loyaltyStatus} onChange={event => setRule('loyaltyStatus', event.target.value as any)} style={fieldStyle}><option value="all">Any loyalty status</option><option value="member">Loyalty members</option><option value="not_member">Retail non-members</option></select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 11, fontSize: 12 }}>
        {([['retail_customer', 'Retail'], ['b2b_customer', 'B2B'], ['both', 'Supplier & B2B']] as const).map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.rules.contactTypes.includes(value)} onChange={() => toggleArray('contactTypes', value)} /> {label}</label>)}
      </div>
      {tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, fontSize: 12 }}>{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={draft.rules.tagIds.includes(tag.id)} onChange={() => toggleArray('tagIds', tag.id)} /> {tag.name}</label>)}</div>}
      {locations.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, fontSize: 12 }}>{locations.map(location => <label key={location.id}><input type="checkbox" checked={draft.rules.locationIds.includes(location.id)} onChange={() => toggleArray('locationIds', location.id)} /> {location.name}</label>)}</div>}
      <div style={{ display: 'flex', gap: 7, marginTop: 13 }}><button disabled={busy} style={{ ...buttonStyle, background: 'var(--sv-action)', color: '#fff' }}>Save</button><button type="button" onClick={() => setEditing(null)} style={buttonStyle}>Cancel</button></div>
    </form>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 8 }}>
      {segments.map(segment => <article key={segment.id} style={{ border: '1px solid var(--sv-etch)', borderRadius: 7, padding: 11, background: 'var(--sv-bg-1)' }}>
        <strong style={{ color: 'var(--sv-text-strong)' }}>{segment.name}</strong>{segment.description && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 3 }}>{segment.description}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}><button disabled={busy} onClick={() => evaluate(segment.id)} style={buttonStyle}><Users size={13} /> View</button>{!isAdvisor && <button title="Edit" onClick={() => openEditor(segment)} style={buttonStyle}><Pencil size={13} /></button>}{!isAdvisor && <button title="Delete" onClick={() => remove(segment)} style={buttonStyle}><Trash2 size={13} /></button>}</div>
      </article>)}
      {!segments.length && <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>No saved segments.</div>}
    </div>
    {selectedId && <section style={{ marginTop: 18, borderTop: '1px solid var(--sv-etch)', paddingTop: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}><strong style={{ flex: 1 }}>{members.length}{truncated ? '+' : ''} matching customers</strong><button onClick={() => evaluate(selectedId)} style={buttonStyle}><RefreshCw size={13} /> Refresh</button><button disabled={!members.length} onClick={exportCsv} style={buttonStyle}><Download size={13} /> CSV</button></div>
      {truncated && <div style={{ color: 'var(--sv-amber)', fontSize: 11, marginBottom: 7 }}>Showing the first 500 matches.</div>}
      {members.map(member => <button key={member.id} onClick={() => onOpenProfile(member.id)} style={{ width: '100%', border: 0, borderBottom: '1px solid var(--sv-etch)', background: 'transparent', padding: '9px 2px', display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(90px, auto) minmax(90px, auto)', gap: 10, textAlign: 'left', color: 'var(--sv-text-main)', cursor: 'pointer' }}><span><strong>{member.name}</strong>{member.company ? ` · ${member.company}` : ''}</span><span>{Number(member.revenue ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</span><span style={{ color: 'var(--sv-text-dim)' }}>{member.last_activity_at ? new Date(member.last_activity_at).toLocaleDateString('en-AU') : 'No activity'}</span></button>)}
    </section>}
  </div>;
}
