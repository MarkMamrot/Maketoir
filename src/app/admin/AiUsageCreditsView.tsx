'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

const money = (value: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value || 0));
const field: React.CSSProperties = { width: '100%', padding: '8px 9px', border: '1px solid #334155', borderRadius: 5, background: '#0f172a', color: '#e2e8f0' };

export default function AiUsageCreditsView() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [rates, setRates] = useState<any>({ provider: [], plans: [] });
  const [rateForm, setRateForm] = useState<any>({ kind: 'provider', planKey: 'starter', modelId: '', metric: 'input_tokens', priceAud: '', unitScale: 1000000, sourceCurrency: 'USD', sourcePriceDecimal: '', audFxRate: '', effectiveFrom: new Date().toISOString().slice(0, 16) });
  const [message, setMessage] = useState('');
  const load = () => Promise.all([
    fetch('/api/admin/ai-billing').then(response => response.json()),
    fetch('/api/admin/ai-billing/rates').then(response => response.json()),
  ]).then(([accounts, rateCards]) => { setRows(accounts.accounts || []); setRates(rateCards); });
  useEffect(() => { load(); }, []);
  const open = async (row: any) => {
    setSelected(row); setMessage('');
    const data = await fetch(`/api/admin/ai-billing/${encodeURIComponent(row.businessId)}`).then(response => response.json());
    setDetail(data); setForm({ ...data.account, command: 'configure', idempotencyKey: crypto.randomUUID(), reason: '' });
  };
  const command = async (body: any) => {
    setMessage('');
    const response = await fetch(`/api/admin/ai-billing/${encodeURIComponent(selected.businessId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || 'Update failed.');
    setMessage('Saved.'); await load(); await open(selected);
  };
  const exportCsv = () => {
    const columns = ['businessName','businessId','planKey','fundingMode','enforcementMode','balanceAud','limitAud','usedAud','reservedAud','providerCostAud','tenantChargeAud','marginAud','calls','unknownCalls'];
    const csv = [columns.join(','), ...rows.map(row => columns.map(column => JSON.stringify(row[column] ?? '')).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'ai-usage-credits.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  const addRate = async () => {
    setMessage('');
    const response = await fetch('/api/admin/ai-billing/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rateForm) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || 'Rate creation failed.');
    setMessage('Saved.'); await load();
  };
  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}><div style={{ flex: 1 }}><h1 style={{ margin: 0, fontSize: 22, color: '#e2e8f0' }}>AI Usage &amp; Credits</h1><p style={{ margin: '5px 0 0', color: '#94a3b8', fontSize: 13 }}>Cross-business provider cost, customer charges, availability, and held reservations.</p></div><button title="Export CSV" onClick={exportCsv} style={field}><Download size={15} /></button><button title="Refresh" onClick={load} style={field}><RefreshCw size={15} /></button></div>
    <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 6 }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}><thead><tr>{['Business','Plan / funding','Status','Available / used','Reserved','Provider cost','Tenant charge','Margin','Calls','Unknown'].map(title => <th key={title} style={{ padding: 10, color: '#94a3b8', fontSize: 11, textAlign: 'left', borderBottom: '1px solid #334155' }}>{title}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.businessId} onClick={() => open(row)} style={{ cursor: 'pointer', borderBottom: '1px solid #1e293b' }}><td style={{ padding: 10, color: '#e2e8f0' }}><strong>{row.businessName}</strong><div style={{ fontSize: 10, color: '#64748b' }}>{row.businessId}</div></td><td style={{ padding: 10 }}>{row.planKey}<div style={{ fontSize: 11, color: '#94a3b8' }}>{row.fundingMode}</div></td><td style={{ padding: 10, color: row.enforcementMode === 'suspended' ? '#f87171' : '#cbd5e1' }}>{row.enforcementMode}</td><td style={{ padding: 10 }}>{row.fundingMode === 'prepaid' ? money(row.balanceAud) : `${money(row.usedAud)} / ${money(row.limitAud)}`}</td><td style={{ padding: 10 }}>{money(row.reservedAud)}</td><td style={{ padding: 10 }}>{money(row.providerCostAud)}</td><td style={{ padding: 10 }}>{money(row.tenantChargeAud)}</td><td style={{ padding: 10 }}>{money(row.marginAud)}</td><td style={{ padding: 10 }}>{row.calls}</td><td style={{ padding: 10, color: row.unknownCalls ? '#fbbf24' : '#94a3b8' }}>{row.unknownCalls}</td></tr>)}</tbody></table></div>
    <div style={{ marginTop: 26, borderTop: '1px solid #334155', paddingTop: 20 }}><h2 style={{ color: '#e2e8f0', fontSize: 16 }}>Effective-dated rate cards</h2><p style={{ color: '#94a3b8', fontSize: 12 }}>Adding a rate closes the prior active row for the same model and metric. Historical rates remain unchanged.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
      <select style={field} value={rateForm.kind} onChange={event => setRateForm({ ...rateForm, kind: event.target.value })}><option value="provider">Provider cost</option><option value="plan">Plan sell rate</option></select>
      {rateForm.kind === 'plan' && <select style={field} value={rateForm.planKey} onChange={event => setRateForm({ ...rateForm, planKey: event.target.value })}>{['starter','core','scale','enterprise','platform'].map(value => <option key={value}>{value}</option>)}</select>}
      <input style={field} placeholder="Model ID" value={rateForm.modelId} onChange={event => setRateForm({ ...rateForm, modelId: event.target.value })} />
      <select style={field} value={rateForm.metric} onChange={event => setRateForm({ ...rateForm, metric: event.target.value })}>{['input_tokens','cached_input_tokens','output_tokens','thinking_tokens','output_image','video_second'].map(value => <option key={value}>{value}</option>)}</select>
      <input style={field} placeholder="AUD price" value={rateForm.priceAud} onChange={event => setRateForm({ ...rateForm, priceAud: event.target.value })} />
      {rateForm.kind === 'provider' && <><input style={field} placeholder="Source price" value={rateForm.sourcePriceDecimal} onChange={event => setRateForm({ ...rateForm, sourcePriceDecimal: event.target.value })} /><input style={field} placeholder="AUD FX rate" value={rateForm.audFxRate} onChange={event => setRateForm({ ...rateForm, audFxRate: event.target.value })} /></>}
      <input style={field} type="datetime-local" value={rateForm.effectiveFrom} onChange={event => setRateForm({ ...rateForm, effectiveFrom: event.target.value })} />
      <button style={{ ...field, background: '#0e7490' }} onClick={addRate}>Add rate</button>
    </div><div style={{ marginTop: 12, color: '#94a3b8', fontSize: 12 }}>{rates.provider.length} provider rates and {rates.plans.length} plan rates configured.</div>{message && !selected && <p style={{ color: message === 'Saved.' ? '#5eead4' : '#f87171' }}>{message}</p>}</div>
    {selected && detail && <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSelected(null)}><div style={{ width: 'min(560px,100vw)', height: '100%', overflowY: 'auto', background: '#111827', padding: 22, boxShadow: '-12px 0 35px rgba(0,0,0,.35)' }} onClick={event => event.stopPropagation()}><div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ flex: 1, color: '#e2e8f0', margin: 0 }}>{selected.businessName}</h2><button title="Close" onClick={() => setSelected(null)} style={{ ...field, width: 38 }}><X size={16} /></button></div>
      <h3 style={{ color: '#cbd5e1', fontSize: 13, marginTop: 24 }}>Account configuration</h3><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Plan<select style={field} value={form.planKey} onChange={event => setForm({ ...form, planKey: event.target.value })}>{['starter','core','scale','enterprise','platform'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Funding<select style={field} value={form.fundingMode} onChange={event => setForm({ ...form, fundingMode: event.target.value })}><option value="prepaid">Prepaid</option><option value="account_limit">Account limit</option></select></label>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Enforcement<select style={field} value={form.enforcementMode} onChange={event => setForm({ ...form, enforcementMode: event.target.value })}>{['observe','enforce','suspended'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Reset<select style={field} value={form.cycleMode} onChange={event => setForm({ ...form, cycleMode: event.target.value })}>{['calendar_month','billing_anniversary','manual'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Limit AUD<input style={field} value={form.limitAud} onChange={event => setForm({ ...form, limitAud: event.target.value })} /></label>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Cycle day<input style={field} type="number" min="1" max="31" value={form.cycleAnchorDay} onChange={event => setForm({ ...form, cycleAnchorDay: Number(event.target.value) })} /></label>
      </div><label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginTop: 10 }}>Reason<input style={field} value={form.reason || ''} onChange={event => setForm({ ...form, reason: event.target.value })} /></label><button onClick={() => command(form)} style={{ ...field, width: 'auto', marginTop: 10, background: '#0e7490' }}>Save configuration</button>
      <h3 style={{ color: '#cbd5e1', fontSize: 13, marginTop: 24 }}>Prepaid credit adjustment</h3><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><input id="credit-amount" style={field} placeholder="Signed AUD amount" /><input id="credit-reference" style={field} placeholder="Payment/reference" /></div><input id="credit-reason" style={{ ...field, marginTop: 10 }} placeholder="Required reason" /><button onClick={() => command({ command: 'adjust_credit', amountAud: (document.getElementById('credit-amount') as HTMLInputElement).value, externalReference: (document.getElementById('credit-reference') as HTMLInputElement).value, reason: (document.getElementById('credit-reason') as HTMLInputElement).value, idempotencyKey: crypto.randomUUID() })} style={{ ...field, width: 'auto', marginTop: 10, background: '#0e7490' }}>Apply adjustment</button>
      <button onClick={() => { const reason = window.prompt('Reason for resetting this account cycle?'); if (reason) command({ command: 'reset_cycle', reason }); }} style={{ ...field, width: 'auto', margin: '24px 0 0 10px' }}>Reset cycle</button>{message && <p style={{ color: message === 'Saved.' ? '#5eead4' : '#f87171' }}>{message}</p>}
      {detail.recentCalls.some((call: any) => call.status === 'unknown') && <><h3 style={{ color: '#cbd5e1', fontSize: 13, marginTop: 24 }}>Unknown reservations</h3>{detail.recentCalls.filter((call: any) => call.status === 'unknown').map((call: any) => <div key={call.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #334155', color: '#cbd5e1', fontSize: 12 }}><span style={{ flex: 1 }}>#{call.id} {call.operation} · {call.model_id}</span><button style={{ ...field, width: 'auto' }} onClick={() => { const reason = window.prompt('Evidence/reason for releasing this reservation?'); if (reason) command({ command: 'release_unknown', callId: call.id, reason }); }}>Release</button></div>)}</>}
    </div></div>}
  </div>;
}