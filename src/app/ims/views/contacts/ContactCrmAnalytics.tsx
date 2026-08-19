'use client';

import { RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { SBDatePicker, type SBDateRange } from '@/app/ims/views/reports/reportFilterHelpers';

const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value || 0));
const percent = (value: number) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const buttonStyle: React.CSSProperties = { minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' };

function dates(range: SBDateRange) {
  if (range.kind === 'range') return { from: range.from, to: range.to };
  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - range.window + 1);
  return { from: from.toLocaleDateString('sv-SE'), to: to.toLocaleDateString('sv-SE') };
}

export function ContactCrmAnalytics({ onOpenProfile }: { onOpenProfile: (id: number) => void }) {
  const [range, setRange] = useState<SBDateRange>({ kind: 'window', window: 365, label: '12 Months' });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    const value = dates(range);
    try {
      const response = await fetch(`/api/ims/contacts/analytics?from=${value.from}&to=${value.to}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Analytics could not be loaded.');
      setData(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Analytics could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [range]);

  if (loading && !data) return <div style={{ color: 'var(--sv-text-dim)', padding: '28px 0' }}>Calculating CRM analytics…</div>;
  return <div>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}><SBDatePicker value={range} onChange={setRange} /><button title="Refresh" onClick={() => void load()} disabled={loading} style={buttonStyle}><RefreshCw size={14} /></button><span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Revenue is tax-inclusive. Follow-up attribution is not a claim of causation.</span></div>
    {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
    {data && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: 8, marginBottom: 22 }}>{[
        ['Lifetime value', money(data.lifetimeValue.total)], ['Average CLV', money(data.lifetimeValue.average)], ['Repeat customers', data.retention.at(-1) ? percent(data.retention.at(-1).retentionRate) : '—'], ['Reactivated', data.reactivation.customers], ['Tasks completed', data.tasks.completed], ['Attributed revenue', money(data.influenced.revenue)],
      ].map(([label, value]) => <div key={String(label)} style={{ border: '1px solid var(--sv-etch)', borderRadius: 7, padding: 11, background: 'var(--sv-bg-1)' }}><div style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{label}</div><div style={{ color: 'var(--sv-text-strong)', fontWeight: 800, fontSize: 18, marginTop: 4 }}>{value}</div></div>)}</div>
      <section style={{ marginBottom: 24 }}><h2 style={{ fontSize: 15, margin: '0 0 9px', color: 'var(--sv-text-strong)' }}>Customer value and RFM</h2>{data.customerResultsTruncated && <div style={{ color: 'var(--sv-amber)', fontSize: 11, marginBottom: 7 }}>Showing the first 500 customers.</div>}<div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}><thead><tr>{['Customer','CLV','Purchases','Recency','R','F','M'].map(label => <th key={label} style={{ textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)', fontSize: 11 }}>{label}</th>)}</tr></thead><tbody>{data.rfm.slice(0, 100).map((row: any) => <tr key={row.contactId}><td style={{ padding: 8, borderBottom: '1px solid var(--sv-etch)' }}><button onClick={() => onOpenProfile(row.contactId)} style={{ border: 0, padding: 0, background: 'none', color: 'var(--sv-action)', fontWeight: 700, cursor: 'pointer' }}>{row.contactName}</button></td><td>{money(row.lifetimeValue)}</td><td>{row.frequency}</td><td>{row.recencyDays}d</td><td>{row.recencyScore}</td><td>{row.frequencyScore}</td><td>{row.monetaryScore}</td></tr>)}</tbody></table></div></section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 22 }}>
        <section><h2 style={{ fontSize: 15, margin: '0 0 9px', color: 'var(--sv-text-strong)' }}>Retention and reactivation</h2>{data.retention.map((row: any) => <div key={row.month} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--sv-etch)', fontSize: 12 }}><span>{row.month} · {row.repeatCustomers}/{row.purchasingCustomers} repeat</span><strong>{percent(row.retentionRate)}</strong></div>)}<div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginTop: 9 }}>{data.reactivation.customers} customers returned after at least {data.reactivation.inactivityDays} days, generating {money(data.reactivation.revenue)}.</div></section>
        <section><h2 style={{ fontSize: 15, margin: '0 0 9px', color: 'var(--sv-text-strong)' }}>Tasks and advisor activity</h2><div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 9 }}>{data.tasks.completed}/{data.tasks.created} completed ({percent(data.tasks.completionRate)}) · {data.tasks.open} open · {data.tasks.overdue} overdue</div>{data.advisors.map((row: any) => <div key={`${row.userId}:${row.name}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--sv-etch)', fontSize: 12 }}><strong>{row.name}</strong><div style={{ color: 'var(--sv-text-dim)', marginTop: 2 }}>{row.completedTasks} tasks · {row.manualInteractions} interactions · {money(row.influencedRevenue)} attributed</div></div>)}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 9 }}>{money(data.influenced.revenue)} from {data.influenced.transactions} purchases within {data.influenced.windowDays} days after the latest completed task; each purchase is counted once.</div></section>
      </div>
    </>}
  </div>;
}