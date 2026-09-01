'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw, Search, X } from 'lucide-react';

import styles from './AiUsageCreditsDashboard.module.css';
import CuratedAiPricingPanel from './CuratedAiPricingPanel';

type AccountRow = {
  businessId: string; businessName: string; planKey: string; fundingMode: string; enforcementMode: string;
  balanceAud: string; limitAud: string; usedAud: string; reservedAud: string; providerCostAud: string;
  tenantChargeAud: string; marginAud: string; calls: number; unknownCalls: number;
};

const money = (value: string | number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(Number(value || 0));
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`${styles.field} ${wide ? styles.fieldWide : ''}`}><label>{label}</label>{children}</div>;
}

export default function AiUsageCreditsDashboardSimple() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/ai-billing');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load AI billing data.');
      setRows(result.accounts || []); setIsError(false);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Could not load AI billing data.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const open = async (row: AccountRow) => {
    setSelected(row); setDetail(null); setMessage('');
    const response = await fetch(`/api/admin/ai-billing/${encodeURIComponent(row.businessId)}`);
    const data = await response.json();
    if (!response.ok) { setIsError(true); setMessage(data.error || 'Could not load account.'); return; }
    setDetail(data); setForm({ ...data.account, command: 'configure', idempotencyKey: crypto.randomUUID(), reason: '' });
  };

  const command = async (body: any) => {
    if (!selected) return;
    setMessage(''); setIsError(false);
    const response = await fetch(`/api/admin/ai-billing/${encodeURIComponent(selected.businessId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setIsError(true); setMessage(result.error || 'Update failed.'); return; }
    setMessage('Account updated.'); await load(); await open(selected);
  };

  const exportCsv = () => {
    const columns = ['businessName','businessId','planKey','fundingMode','enforcementMode','balanceAud','limitAud','usedAud','reservedAud','providerCostAud','tenantChargeAud','marginAud','calls','unknownCalls'];
    const csv = [columns.join(','), ...rows.map(row => columns.map(column => JSON.stringify(row[column as keyof AccountRow] ?? '')).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'ai-usage-credits.csv'; link.click(); URL.revokeObjectURL(link.href);
  };

  const query = search.trim().toLowerCase();
  const visibleRows = rows.filter(row => (!query || row.businessName.toLowerCase().includes(query) || row.businessId.toLowerCase().includes(query)) && (status === 'all' || row.enforcementMode === status));
  const totals = rows.reduce((result, row) => ({ provider: result.provider + Number(row.providerCostAud), charged: result.charged + Number(row.tenantChargeAud), calls: result.calls + Number(row.calls), unknown: result.unknown + Number(row.unknownCalls) }), { provider: 0, charged: 0, calls: 0, unknown: 0 });

  return <div className={styles.root}>
    <header className={styles.header}><div className={styles.heading}><h1 className={styles.title}>AI Usage &amp; Credits</h1><p className={styles.subtitle}>Monitor account usage and maintain the six supported Google model costs and plan margins.</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} onClick={exportCsv}><Download size={15} /><span>Export CSV</span></button><button className={styles.iconButton} title="Refresh accounts" aria-label="Refresh accounts" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button></div></header>

    <section className={styles.summaryGrid} aria-label="AI billing summary">
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Provider cost</div><div className={styles.summaryValue}>{money(totals.provider)}</div><div className={styles.summaryNote}>Recorded settlement cost</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Customer charges</div><div className={styles.summaryValue}>{money(totals.charged)}</div><div className={styles.summaryNote}>Across {rows.length} accounts</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Margin</div><div className={styles.summaryValue}>{money(totals.charged - totals.provider)}</div><div className={styles.summaryNote}>{totals.calls.toLocaleString()} provider calls</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Needs review</div><div className={`${styles.summaryValue} ${totals.unknown ? styles.warning : ''}`}>{totals.unknown}</div><div className={styles.summaryNote}>Unknown reservations</div></div>
    </section>

    <CuratedAiPricingPanel />

    <section className={styles.panel}><div className={styles.panelHeader}><div className={styles.sectionHeader}><div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>Business accounts</h2><p className={styles.sectionDescription}>Select a business to manage funding, enforcement, and cycle settings.</p></div><div className={styles.filters}><div className={styles.search}><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ai-muted)' }} /><input className={styles.input} style={{ paddingLeft: 31 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search businesses" aria-label="Search businesses" /></div></div><select className={`${styles.select} ${styles.statusFilter}`} value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by enforcement"><option value="all">All statuses</option><option value="observe">Observe</option><option value="enforce">Enforce</option><option value="suspended">Suspended</option></select></div></div></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Business</th><th>Plan</th><th>Status</th><th className={styles.numeric}>Available / used</th><th className={styles.numeric}>Reserved</th><th className={styles.numeric}>Provider cost</th><th className={styles.numeric}>Customer charge</th><th className={styles.numeric}>Margin</th><th className={styles.numeric}>Calls</th><th className={styles.numeric}>Unknown</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.businessId} onClick={() => void open(row)}><td><div className={styles.businessName}>{row.businessName}</div><div className={styles.businessId} title={row.businessId}>{row.businessId}</div></td><td><strong>{title(row.planKey)}</strong><div className={styles.muted}>{title(row.fundingMode)}</div></td><td><span className={`${styles.pill} ${styles[row.enforcementMode as 'observe'|'enforce'|'suspended'] || ''}`}>{row.enforcementMode}</span></td><td className={styles.numeric}>{row.fundingMode === 'prepaid' ? money(row.balanceAud) : <>{money(row.usedAud)} <span className={styles.muted}>/ {money(row.limitAud)}</span></>}</td><td className={styles.numeric}>{money(row.reservedAud)}</td><td className={styles.numeric}>{money(row.providerCostAud)}</td><td className={styles.numeric}>{money(row.tenantChargeAud)}</td><td className={styles.numeric}>{money(row.marginAud)}</td><td className={styles.numeric}>{row.calls.toLocaleString()}</td><td className={`${styles.numeric} ${row.unknownCalls ? styles.warning : ''}`}>{row.unknownCalls}</td></tr>)}</tbody></table>{!loading && visibleRows.length === 0 && <div className={styles.empty}>No accounts match the current filters.</div>}</div>
      {message && !selected && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}
    </section>

    {selected && <div className={styles.backdrop} onClick={() => setSelected(null)}><aside className={styles.drawer} aria-label={`${selected.businessName} AI account`} onClick={event => event.stopPropagation()}><div className={styles.drawerHeader}><div className={styles.drawerTitle}><h2>{selected.businessName}</h2><p>{selected.businessId}</p></div><button className={styles.iconButton} title="Close" aria-label="Close" onClick={() => setSelected(null)}><X size={16} /></button></div><div className={styles.drawerBody}>{!detail ? <div className={styles.empty}>Loading account...</div> : <>
      <section className={styles.drawerSection}><h3>Account configuration</h3><div className={styles.formGrid}><Field label="Plan"><div className={styles.readOnlyValue}>{title(form.planKey)}<span>Manage in Business Settings</span></div></Field><Field label="Funding"><select className={styles.select} value={form.fundingMode} onChange={event => setForm({ ...form, fundingMode: event.target.value })}><option value="prepaid">Prepaid</option><option value="account_limit">Account limit</option></select></Field><Field label="Enforcement"><select className={styles.select} value={form.enforcementMode} onChange={event => setForm({ ...form, enforcementMode: event.target.value })}>{['observe','enforce','suspended'].map(value => <option key={value}>{title(value)}</option>)}</select></Field><Field label="Reset policy"><select className={styles.select} value={form.cycleMode} onChange={event => setForm({ ...form, cycleMode: event.target.value })}>{['calendar_month','billing_anniversary','manual'].map(value => <option key={value} value={value}>{title(value)}</option>)}</select></Field><Field label="Limit (AUD)"><input className={styles.input} value={form.limitAud} onChange={event => setForm({ ...form, limitAud: event.target.value })} /></Field><Field label="Cycle day"><input className={styles.input} type="number" min="1" max="31" value={form.cycleAnchorDay} onChange={event => setForm({ ...form, cycleAnchorDay: Number(event.target.value) })} /></Field><Field label="Change reason" wide><input className={styles.input} value={form.reason || ''} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Required audit note" /></Field></div><div className={styles.drawerActions}><button className={styles.primaryButton} onClick={() => void command(form)}>Save configuration</button></div></section>
      <CreditAdjustment onApply={body => void command(body)} />
      <section className={styles.drawerSection}><h3>Cycle controls</h3><p className={styles.sectionDescription}>A manual reset clears cycle usage but keeps unresolved reservations held.</p><div className={styles.drawerActions}><button className={styles.secondaryButton} onClick={() => { const reason = window.prompt('Reason for resetting this account cycle?'); if (reason) void command({ command: 'reset_cycle', reason }); }}>Reset cycle</button></div></section>
      {detail.recentCalls.some((call: any) => call.status === 'unknown') && <section className={styles.drawerSection}><h3>Unknown reservations</h3>{detail.recentCalls.filter((call: any) => call.status === 'unknown').map((call: any) => <div className={styles.unknownRow} key={call.id}><div className={styles.unknownDetails}><strong>Call #{call.id}</strong><div className={styles.muted}>{title(call.operation)} · {call.model_id}</div></div><button className={styles.dangerButton} onClick={() => { const reason = window.prompt('Evidence or reason for releasing this reservation?'); if (reason) void command({ command: 'release_unknown', callId: call.id, reason }); }}>Release</button></div>)}</section>}
      {message && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}
    </>}</div></aside></div>}
  </div>;
}

function CreditAdjustment({ onApply }: { onApply: (body: Record<string, unknown>) => void }) {
  const [amount, setAmount] = useState(''); const [reference, setReference] = useState(''); const [reason, setReason] = useState('');
  return <section className={styles.drawerSection}><h3>Prepaid credit adjustment</h3><div className={styles.formGrid}><Field label="Signed amount (AUD)"><input className={styles.input} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="250.00 or -25.00" /></Field><Field label="Payment / reference"><input className={styles.input} value={reference} onChange={event => setReference(event.target.value)} /></Field><Field label="Adjustment reason" wide><input className={styles.input} value={reason} onChange={event => setReason(event.target.value)} placeholder="Required audit reason" /></Field></div><div className={styles.drawerActions}><button className={styles.primaryButton} onClick={() => onApply({ command: 'adjust_credit', amountAud: amount, externalReference: reference, reason, idempotencyKey: crypto.randomUUID() })}>Apply adjustment</button></div></section>;
}