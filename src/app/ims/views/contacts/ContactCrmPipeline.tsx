'use client';

import { Pencil, Plus, Settings2, UserRound } from 'lucide-react';
import React, { useEffect, useState } from 'react';

type Stage = { id: number; name: string; position: number; category: 'open' | 'won' | 'lost'; default_probability: number; color?: string | null };
type Opportunity = { id: number; contact_id: number; contact_name: string; contact_company?: string | null; contact_type: string; stage_id: number; title: string; description?: string | null; expected_value: number; probability: number; owner_name?: string | null; next_action_date?: string | null; lost_reason?: string | null };
type Contact = { id: number; name: string; company?: string | null; type: string };
type Assignee = { id: number; name: string };

const fieldStyle: React.CSSProperties = { minHeight: 36, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '7px 9px', fontSize: 12, minWidth: 0 };
const buttonStyle: React.CSSProperties = { minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
async function apiJson(url: string, init?: RequestInit) { const response = await fetch(url, init); const payload = await response.json().catch(() => ({})); if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.'); return payload; }

export function ContactCrmPipeline({ contacts, assignees, isAdvisor, onOpenProfile, onContactsChanged }: { contacts: Contact[]; assignees: Assignee[]; isAdvisor: boolean; onOpenProfile: (id: number) => void; onContactsChanged: () => void }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [creating, setCreating] = useState(false);
  const [stageSettings, setStageSettings] = useState(false);
  const [draft, setDraft] = useState({ contactId: '', stageId: '', title: '', description: '', expectedValue: '', probability: '', ownerUserId: '', nextActionDate: '' });
  const [stageDraft, setStageDraft] = useState({ id: '', name: '', position: '', category: 'open', defaultProbability: '0', color: '#64748b' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligibleContacts = contacts.filter(contact => ['lead', 'retail_customer', 'b2b_customer', 'both'].includes(contact.type));

  const load = async () => { const payload = await apiJson('/api/ims/contacts/pipeline'); setStages(payload.data?.stages ?? []); setOpportunities(payload.data?.opportunities ?? []); setTruncated(Boolean(payload.data?.truncated)); };
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, []);

  const createOpportunity = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await apiJson('/api/ims/contacts/pipeline/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); setCreating(false); setDraft({ contactId: '', stageId: '', title: '', description: '', expectedValue: '', probability: '', ownerUserId: '', nextActionDate: '' }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Opportunity could not be created.'); } finally { setBusy(false); }
  };
  const move = async (opportunity: Opportunity, stageId: number) => {
    const stage = stages.find(item => item.id === stageId); if (!stage || stageId === opportunity.stage_id) return;
    const body: Record<string, unknown> = { stageId };
    if (stage.category === 'lost') body.lostReason = prompt('Lost reason (optional)') ?? '';
    if (stage.category === 'won' && opportunity.contact_type === 'lead') {
      const choice = prompt('Convert lead to “retail” or “b2b”?');
      if (!choice) return;
      body.conversionType = choice.trim().toLowerCase() === 'retail' ? 'retail_customer' : choice.trim().toLowerCase() === 'b2b' ? 'b2b_customer' : '';
    }
    setBusy(true); setError('');
    try { await apiJson(`/api/ims/contacts/pipeline/opportunities/${opportunity.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await load(); if (stage.category === 'won' && opportunity.contact_type === 'lead') onContactsChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Opportunity could not be moved.'); } finally { setBusy(false); }
  };
  const editStage = (stage?: Stage) => { setStageDraft(stage ? { id: String(stage.id), name: stage.name, position: String(stage.position), category: stage.category, defaultProbability: String(stage.default_probability), color: stage.color ?? '#64748b' } : { id: '', name: '', position: String((stages.at(-1)?.position ?? 0) + 10), category: 'open', defaultProbability: '0', color: '#64748b' }); };
  const saveStage = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await apiJson(stageDraft.id ? `/api/ims/contacts/pipeline/stages/${stageDraft.id}` : '/api/ims/contacts/pipeline', { method: stageDraft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stageDraft) }); setStageDraft({ id: '', name: '', position: '', category: 'open', defaultProbability: '0', color: '#64748b' }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Stage could not be saved.'); } finally { setBusy(false); }
  };
  const weightedValue = opportunities.filter(item => stages.find(stage => stage.id === item.stage_id)?.category === 'open').reduce((sum, item) => sum + Number(item.expected_value) * Number(item.probability) / 100, 0);

  return <div style={{ minWidth: 0 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}><div style={{ flex: 1, minWidth: 220 }}><strong style={{ color: 'var(--sv-text-strong)' }}>Opportunity pipeline</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Forecast-only, tax-inclusive AUD · Weighted open value {weightedValue.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</div></div>{!isAdvisor && <button onClick={() => setCreating(value => !value)} style={{ ...buttonStyle, background: 'var(--sv-action)', color: '#fff' }}><Plus size={14} /> Opportunity</button>}{!isAdvisor && <button onClick={() => setStageSettings(value => !value)} style={buttonStyle}><Settings2 size={14} /> Stages</button>}</div>
    {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}{truncated && <div style={{ color: 'var(--sv-amber)', fontSize: 11, marginBottom: 8 }}>Showing the first 1,000 opportunities.</div>}
    {creating && <form onSubmit={createOpportunity} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8, borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)', padding: '12px 0', marginBottom: 12 }}>
      <select required value={draft.contactId} onChange={event => setDraft(current => ({ ...current, contactId: event.target.value }))} style={fieldStyle}><option value="">Lead or customer</option>{eligibleContacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}{contact.company ? ` · ${contact.company}` : ''}</option>)}</select>
      <select required value={draft.stageId} onChange={event => { const stage = stages.find(item => item.id === Number(event.target.value)); setDraft(current => ({ ...current, stageId: event.target.value, probability: stage ? String(stage.default_probability) : current.probability })); }} style={fieldStyle}><option value="">Stage</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>
      <input required value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="Opportunity title" style={fieldStyle} />
      <input type="number" required min="0" step="0.01" value={draft.expectedValue} onChange={event => setDraft(current => ({ ...current, expectedValue: event.target.value }))} placeholder="Expected value AUD" style={fieldStyle} />
      <input type="number" min="0" max="100" value={draft.probability} onChange={event => setDraft(current => ({ ...current, probability: event.target.value }))} placeholder="Probability %" style={fieldStyle} />
      <select value={draft.ownerUserId} onChange={event => setDraft(current => ({ ...current, ownerUserId: event.target.value }))} style={fieldStyle}><option value="">Unassigned</option>{assignees.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
      <input type="date" value={draft.nextActionDate} onChange={event => setDraft(current => ({ ...current, nextActionDate: event.target.value }))} style={fieldStyle} />
      <input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="Details" style={fieldStyle} />
      <div style={{ display: 'flex', gap: 7 }}><button disabled={busy} style={{ ...buttonStyle, background: 'var(--sv-action)', color: '#fff' }}>Create</button><button type="button" onClick={() => setCreating(false)} style={buttonStyle}>Cancel</button></div>
    </form>}
    {stageSettings && <section style={{ borderBottom: '1px solid var(--sv-etch)', paddingBottom: 12, marginBottom: 12 }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{stages.map(stage => <button key={stage.id} onClick={() => editStage(stage)} style={buttonStyle}><span style={{ width: 9, height: 9, borderRadius: '50%', background: stage.color ?? '#64748b' }} />{stage.name}<Pencil size={11} /></button>)}<button onClick={() => editStage()} style={buttonStyle}><Plus size={12} /> Stage</button></div>{stageDraft.position !== '' && <form onSubmit={saveStage} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 7 }}><input required value={stageDraft.name} onChange={event => setStageDraft(current => ({ ...current, name: event.target.value }))} placeholder="Stage name" style={fieldStyle} /><input type="number" required value={stageDraft.position} onChange={event => setStageDraft(current => ({ ...current, position: event.target.value }))} placeholder="Position" style={fieldStyle} /><select value={stageDraft.category} onChange={event => setStageDraft(current => ({ ...current, category: event.target.value }))} style={fieldStyle}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select><input type="number" min="0" max="100" required value={stageDraft.defaultProbability} onChange={event => setStageDraft(current => ({ ...current, defaultProbability: event.target.value }))} placeholder="Probability" style={fieldStyle} /><input type="color" value={stageDraft.color} onChange={event => setStageDraft(current => ({ ...current, color: event.target.value }))} style={{ ...fieldStyle, padding: 4 }} /><button disabled={busy} style={buttonStyle}>Save stage</button></form>}</section>}
    <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(255px, 1fr)', gap: 10, overflowX: 'auto', paddingBottom: 9 }}>
      {stages.map(stage => { const rows = opportunities.filter(item => item.stage_id === stage.id); const total = rows.reduce((sum, item) => sum + Number(item.expected_value), 0); return <section key={stage.id} style={{ minWidth: 0, borderTop: `3px solid ${stage.color ?? '#64748b'}`, background: 'var(--sv-bg-2)', padding: '9px 8px' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><strong>{stage.name} ({rows.length})</strong><span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{total.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })}</span></div>{rows.map(opportunity => <article key={opportunity.id} style={{ border: '1px solid var(--sv-etch)', borderRadius: 7, background: 'var(--sv-bg-1)', padding: 9, marginBottom: 7 }}><strong style={{ display: 'block', fontSize: 12 }}>{opportunity.title}</strong><button onClick={() => onOpenProfile(opportunity.contact_id)} style={{ border: 0, background: 'transparent', color: 'var(--sv-action)', padding: '4px 0', cursor: 'pointer', fontSize: 11 }}><UserRound size={11} /> {opportunity.contact_name}</button><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}><span>{Number(opportunity.expected_value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</span><span>{opportunity.probability}%</span></div>{opportunity.owner_name && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--sv-text-dim)' }}>{opportunity.owner_name}</div>}{!isAdvisor && <select disabled={busy} value={opportunity.stage_id} onChange={event => void move(opportunity, Number(event.target.value))} style={{ ...fieldStyle, width: '100%', marginTop: 7, minHeight: 30, padding: '4px 6px' }}>{stages.map(option => <option key={option.id} value={option.id}>Move to {option.name}</option>)}</select>}</article>)}</section>; })}
    </div>
  </div>;
}
