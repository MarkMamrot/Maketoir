'use client';

import { AlertTriangle, Merge, Pencil, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';

type Contact = { id: number; name: string; company?: string | null; email?: string | null; phone?: string | null; mobile?: string | null; customer_code?: string | null; store_credit?: number; loyalty_account_count?: number };
type Candidate = { left: Contact; right: Contact; score: number; confidence: string; reasons: string[]; blockers: string[] };
type InvalidContact = { contact: Contact; errors: string[] };

const buttonStyle: React.CSSProperties = { minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' };

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function ContactSummary({ contact }: { contact: Contact }) {
  return <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, color: 'var(--sv-text-strong)', overflowWrap: 'anywhere' }}>{contact.name}</div><div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 3, overflowWrap: 'anywhere' }}>{[contact.company, contact.email, contact.mobile || contact.phone, contact.customer_code].filter(Boolean).join(' · ') || `Contact #${contact.id}`}</div>{(Number(contact.store_credit ?? 0) !== 0 || Number(contact.loyalty_account_count ?? 0) > 0) && <div style={{ fontSize: 11, color: 'var(--sv-amber)', marginTop: 4 }}>{Number(contact.store_credit ?? 0) !== 0 ? `Credit $${Number(contact.store_credit).toFixed(2)}` : ''}{Number(contact.store_credit ?? 0) !== 0 && Number(contact.loyalty_account_count ?? 0) > 0 ? ' · ' : ''}{Number(contact.loyalty_account_count ?? 0) > 0 ? 'Loyalty account' : ''}</div>}</div>;
}

export function ContactCrmDataQuality({ isAdvisor, onEditContact, onMerged }: { isAdvisor: boolean; onEditContact: (id: number) => void; onMerged: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [invalidContacts, setInvalidContacts] = useState<InvalidContact[]>([]);
  const [survivors, setSurvivors] = useState<Record<string, number>>({});
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const payload = await apiJson('/api/ims/contacts/data-quality');
      setCandidates(payload.data?.candidates ?? []);
      setInvalidContacts(payload.data?.invalidContacts ?? []);
      setTruncated(Boolean(payload.data?.truncated));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Data quality could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const merge = async (candidate: Candidate) => {
    const key = `${candidate.left.id}:${candidate.right.id}`;
    const targetContactId = survivors[key] ?? candidate.left.id;
    const sourceContactId = targetContactId === candidate.left.id ? candidate.right.id : candidate.left.id;
    if (!confirm(`Merge ${sourceContactId} into ${targetContactId}? The merged-away contact will be retained as an inactive audit record.`)) return;
    setBusy(sourceContactId); setError('');
    try {
      await apiJson('/api/ims/contacts/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceContactId, targetContactId }) });
      onMerged();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Contacts could not be merged.'); }
    finally { setBusy(null); }
  };

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Duplicate review</div><div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 2 }}>Exact email and phone matches rank highest. Name and address matches are suggestions only.</div></div><button onClick={() => void load()} disabled={loading} title="Refresh" style={buttonStyle}><RefreshCw size={14} /></button></div>
    {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
    {truncated && <div style={{ color: 'var(--sv-amber)', fontSize: 12, marginBottom: 12 }}>Showing the first 500 candidate pairs.</div>}
    {loading ? <div style={{ color: 'var(--sv-text-dim)', padding: '24px 0' }}>Scanning customer contacts…</div> : <div style={{ display: 'grid', gap: 9 }}>
      {candidates.map(candidate => { const key = `${candidate.left.id}:${candidate.right.id}`; const survivor = survivors[key] ?? candidate.left.id; return <article key={key} style={{ border: '1px solid var(--sv-etch)', borderRadius: 7, padding: 12, background: 'var(--sv-bg-1)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}><strong style={{ color: candidate.confidence === 'high' ? 'var(--sv-action)' : 'var(--sv-amber)', fontSize: 12 }}>{candidate.score}% {candidate.confidence}</strong><span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{candidate.reasons.join(' · ')}</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 9 }}>{[candidate.left, candidate.right].map(contact => <label key={contact.id} style={{ display: 'flex', gap: 9, padding: 9, border: `1px solid ${survivor === contact.id ? 'var(--sv-action)' : 'var(--sv-etch)'}`, borderRadius: 6, cursor: isAdvisor ? 'default' : 'pointer' }}><input type="radio" name={`survivor-${key}`} checked={survivor === contact.id} disabled={isAdvisor} onChange={() => setSurvivors(current => ({ ...current, [key]: contact.id }))} /><div><div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--sv-text-dim)', marginBottom: 3 }}>Surviving contact</div><ContactSummary contact={contact} /></div></label>)}</div>
        {candidate.blockers.length > 0 && <div style={{ display: 'flex', gap: 6, color: 'var(--sv-amber)', fontSize: 11, marginTop: 9 }}><AlertTriangle size={13} />{candidate.blockers.join(' ')}</div>}
        {!isAdvisor && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button onClick={() => void merge(candidate)} disabled={busy !== null} style={{ ...buttonStyle, background: 'var(--sv-action)', color: '#fff' }}><Merge size={14} />{busy !== null ? 'Merging…' : 'Merge selected'}</button></div>}
      </article>; })}
      {!candidates.length && <div style={{ color: 'var(--sv-text-dim)', padding: '20px 0' }}>No duplicate customer candidates found.</div>}
    </div>}
    <section style={{ marginTop: 24, borderTop: '1px solid var(--sv-etch)', paddingTop: 16 }}><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sv-text-strong)', marginBottom: 9 }}>Invalid contact details ({invalidContacts.length})</div>{invalidContacts.map(item => <div key={item.contact.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid var(--sv-etch)', padding: '9px 0' }}><div style={{ flex: 1 }}><ContactSummary contact={item.contact} /><div style={{ color: 'var(--sv-red)', fontSize: 11, marginTop: 3 }}>{item.errors.join(' ')}</div></div>{!isAdvisor && <button title="Edit contact" onClick={() => onEditContact(item.contact.id)} style={buttonStyle}><Pencil size={13} /></button>}</div>)}{!invalidContacts.length && <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>All active customer email addresses and phone numbers are valid.</div>}</section>
  </div>;
}