'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const money = (value: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(Number(value || 0));
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());

export default function AccountAiCreditsSection() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true); setError('');
    fetch('/api/ims/account/ai').then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load AI account.');
      setData(body);
    }).catch(error => setError(error.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  if (loading) return <div style={{ color: 'var(--sv-text-dim)', padding: 20 }}>Loading AI account...</div>;
  if (error) return <div style={{ color: 'var(--sv-red)', padding: 20 }}>{error}</div>;
  const account = data.account;
  const exhausted = Number(account.remainingAud) <= 0 || account.enforcementMode === 'suspended';
  return <div style={{ maxWidth: 980 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 22 }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--sv-text-main)' }}>Account &amp; AI Credits</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>AI usage value in AUD. Different models, input, output, images, and video consume different amounts.</p>
      </div>
      <button onClick={load} title="Refresh account" style={{ border: '1px solid var(--sv-border)', background: 'var(--sv-bg-elevated)', color: 'var(--sv-text-main)', padding: 8, borderRadius: 6 }}><RefreshCw size={15} /></button>
    </div>
    {exhausted && <div style={{ display: 'flex', gap: 9, padding: 12, marginBottom: 16, border: '1px solid var(--sv-red)', color: 'var(--sv-red)', borderRadius: 6 }}><AlertTriangle size={18} /> AI is unavailable because this account is exhausted or suspended. Contact your administrator to restore access.</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 24 }}>
      {[
        ['Available', money(account.remainingAud)], ['Reserved', money(account.reservedAud)],
        [account.fundingMode === 'prepaid' ? 'Credit balance' : 'Cycle used', money(account.fundingMode === 'prepaid' ? account.balanceAud : account.usedAud)],
        ['Plan', account.planName], ['Account type', label(account.fundingMode)], ['Status', label(account.enforcementMode)],
      ].map(([title, value]) => <div key={title} style={{ border: '1px solid var(--sv-border)', borderRadius: 6, padding: 14, background: 'var(--sv-bg-elevated)' }}><div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginBottom: 5 }}>{title}</div><strong style={{ color: 'var(--sv-text-main)', fontSize: 17 }}>{value}</strong></div>)}
    </div>
    <h3 style={{ fontSize: 14, color: 'var(--sv-text-main)' }}>Last 30 days by area</h3>
    <div style={{ overflowX: 'auto', border: '1px solid var(--sv-border)', borderRadius: 6, marginBottom: 22 }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}><thead><tr>{['Area','Calls','AI usage value'].map(value => <th key={value} style={{ textAlign: 'left', padding: 10, fontSize: 11, color: 'var(--sv-text-dim)', borderBottom: '1px solid var(--sv-border)' }}>{value}</th>)}</tr></thead><tbody>{data.usageByArea.map((row: any) => <tr key={row.area}><td style={{ padding: 10 }}>{label(row.area)}</td><td style={{ padding: 10 }}>{row.calls}</td><td style={{ padding: 10 }}>{money(row.chargeAud)}</td></tr>)}</tbody></table></div>
    <h3 style={{ fontSize: 14, color: 'var(--sv-text-main)' }}>Recent usage</h3>
    <div style={{ overflowX: 'auto', border: '1px solid var(--sv-border)', borderRadius: 6 }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}><thead><tr>{['When','Area','Operation','Model','Status','Charge'].map(value => <th key={value} style={{ textAlign: 'left', padding: 10, fontSize: 11, color: 'var(--sv-text-dim)', borderBottom: '1px solid var(--sv-border)' }}>{value}</th>)}</tr></thead><tbody>{data.recentCalls.map((row: any, index: number) => <tr key={index}><td style={{ padding: 10, whiteSpace: 'nowrap' }}>{new Date(row.created_at).toLocaleString()}</td><td style={{ padding: 10 }}>{label(row.area)}</td><td style={{ padding: 10 }}>{label(row.operation)}</td><td style={{ padding: 10 }}>{row.model_id}</td><td style={{ padding: 10 }}>{label(row.status)}</td><td style={{ padding: 10 }}>{money(row.chargeAud)}</td></tr>)}</tbody></table></div>
  </div>;
}