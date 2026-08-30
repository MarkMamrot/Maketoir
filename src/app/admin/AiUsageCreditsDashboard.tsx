'use client';

import { useEffect, useState } from 'react';
import { Check, Download, Pencil, RefreshCw, Search, X } from 'lucide-react';
import styles from './AiUsageCreditsDashboard.module.css';

type AccountRow = {
  businessId: string; businessName: string; planKey: string; fundingMode: string; enforcementMode: string;
  balanceAud: string; limitAud: string; usedAud: string; reservedAud: string; providerCostAud: string;
  tenantChargeAud: string; marginAud: string; calls: number; unknownCalls: number;
};

const money = (value: string | number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }).format(Number(value || 0));
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
const localDateTimeValue = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const initialRate = () => ({ kind: 'provider', planKey: 'starter', modelId: '', metric: 'input_tokens', priceAud: '', unitScale: 1000000, sourceCurrency: 'USD', sourcePriceDecimal: '', audFxRate: '', effectiveFrom: localDateTimeValue() });
const initialMarkups = () => ({ starter: '', core: '', scale: '', enterprise: '', platform: '' });

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={`${styles.field} ${wide ? styles.fieldWide : ''}`}><label>{label}</label>{children}</div>;
}

export default function AiUsageCreditsDashboard() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [rates, setRates] = useState<any>({ provider: [], plans: [] });
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [rateForm, setRateForm] = useState<any>(initialRate);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [googlePreview, setGooglePreview] = useState<any>(null);
  const [googleSelected, setGoogleSelected] = useState<string[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [markups, setMarkups] = useState<Record<string, string>>(initialMarkups);
  const [markupLoading, setMarkupLoading] = useState(false);
  const [planRateFilter, setPlanRateFilter] = useState('all');
  const [editingRateLabel, setEditingRateLabel] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [accountsResponse, ratesResponse] = await Promise.all([fetch('/api/admin/ai-billing'), fetch('/api/admin/ai-billing/rates')]);
      const [accounts, rateCards] = await Promise.all([accountsResponse.json(), ratesResponse.json()]);
      if (!accountsResponse.ok || !ratesResponse.ok) throw new Error(accounts.error || rateCards.error || 'Could not load AI billing data.');
      setRows(accounts.accounts || []); setRates(rateCards);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Could not load AI billing data.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const open = async (row: AccountRow) => {
    setSelected(row); setDetail(null); setMessage('');
    const response = await fetch(`/api/admin/ai-billing/${encodeURIComponent(row.businessId)}`);
    const data = await response.json();
    if (!response.ok) { setIsError(true); setMessage(data.error || 'Could not load account.'); return; }
    setDetail(data);
    setForm({ ...data.account, command: 'configure', idempotencyKey: crypto.randomUUID(), reason: '' });
  };

  const command = async (body: any) => {
    if (!selected) return;
    setMessage(''); setIsError(false);
    const response = await fetch(`/api/admin/ai-billing/${encodeURIComponent(selected.businessId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setIsError(true); setMessage(result.error || 'Update failed.'); return; }
    setMessage('Account updated.'); await load(); await open(selected);
  };

  const addRate = async () => {
    setMessage(''); setIsError(false);
    const response = await fetch('/api/admin/ai-billing/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rateForm, effectiveFrom: new Date(rateForm.effectiveFrom).toISOString() }) });
    const result = await response.json();
    if (!response.ok) { setIsError(true); setMessage(result.error || 'Rate creation failed.'); return; }
    setMessage(editingRateLabel ? 'Updated sell rate activated. The previous rate remains in history.' : 'Rate added.');
    setEditingRateLabel(''); setRateForm(initialRate()); await load();
  };

  const previewGoogleRates = async () => {
    setGoogleLoading(true); setMessage(''); setIsError(false);
    try {
      const response = await fetch('/api/admin/ai-billing/rates/google');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Google rate preview failed.');
      setGooglePreview(result);
      setGoogleSelected(result.candidates.filter((candidate: any) => candidate.status !== 'unchanged').map((candidate: any) => candidate.id));
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Google rate preview failed.'); }
    finally { setGoogleLoading(false); }
  };

  const approveGoogleRates = async () => {
    if (!googleSelected.length || !window.confirm(`Activate ${googleSelected.length} Google provider rate${googleSelected.length === 1 ? '' : 's'}?`)) return;
    setGoogleLoading(true); setMessage(''); setIsError(false);
    try {
      const response = await fetch('/api/admin/ai-billing/rates/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateIds: googleSelected }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Google rate import failed.');
      await load(); await previewGoogleRates();
      setIsError(false);
      setMessage(`${result.imported} Google rate${result.imported === 1 ? '' : 's'} activated${result.skipped ? `; ${result.skipped} unchanged` : ''}.`);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Google rate import failed.'); }
    finally { setGoogleLoading(false); }
  };

  const applyPlanMarkups = async () => {
    const selectedPlans = Object.entries(markups).filter(([, value]) => value.trim() !== '');
    if (!selectedPlans.length) { setIsError(true); setMessage('Enter a markup for at least one plan.'); return; }
    const affectedRates = activeProviderRates.length * selectedPlans.length;
    if (!window.confirm(`Create ${affectedRates} customer sell rates across ${selectedPlans.length} plan${selectedPlans.length === 1 ? '' : 's'}? Existing active rates for those plans will end when the new rates begin.`)) return;
    setMarkupLoading(true); setMessage(''); setIsError(false);
    try {
      const response = await fetch('/api/admin/ai-billing/rates/markup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markups }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Plan markup update failed.');
      await load(); setMarkups(initialMarkups());
      setMessage(`${result.rates} customer sell rates activated across ${result.plans} plan${result.plans === 1 ? '' : 's'}, based on ${result.providerRates} active provider rates.`);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'Plan markup update failed.'); }
    finally { setMarkupLoading(false); }
  };

  const exportCsv = () => {
    const columns = ['businessName','businessId','planKey','fundingMode','enforcementMode','balanceAud','limitAud','usedAud','reservedAud','providerCostAud','tenantChargeAud','marginAud','calls','unknownCalls'];
    const csv = [columns.join(','), ...rows.map(row => columns.map(column => JSON.stringify(row[column as keyof AccountRow] ?? '')).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'ai-usage-credits.csv'; link.click(); URL.revokeObjectURL(link.href);
  };

  const editPlanRate = (rate: any) => {
    setRateForm({ kind: 'plan', planKey: rate.plan_key, modelId: rate.model_id, metric: rate.metric, priceAud: rate.priceAud, unitScale: Number(rate.unit_scale), sourceCurrency: 'AUD', sourcePriceDecimal: '', audFxRate: '', effectiveFrom: localDateTimeValue() });
    setEditingRateLabel(`${title(rate.plan_key)} · ${rate.model_id} · ${title(rate.metric)}`);
    setMessage(''); setIsError(false);
    window.setTimeout(() => document.getElementById('manual-rate-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const query = search.trim().toLowerCase();
  const visibleRows = rows.filter(row => (!query || row.businessName.toLowerCase().includes(query) || row.businessId.toLowerCase().includes(query)) && (status === 'all' || row.enforcementMode === status));
  const totals = rows.reduce((result, row) => ({ provider: result.provider + Number(row.providerCostAud), charged: result.charged + Number(row.tenantChargeAud), calls: result.calls + Number(row.calls), unknown: result.unknown + Number(row.unknownCalls) }), { provider: 0, charged: 0, calls: 0, unknown: 0 });
  const activeProviderRates = rates.provider.filter((rate: any) => !rate.effective_to);
  const activePlanRates = rates.plans.filter((rate: any) => !rate.effective_to);
  const visiblePlanRates = activePlanRates.filter((rate: any) => planRateFilter === 'all' || rate.plan_key === planRateFilter);
  const providerRateByKey = new Map(activeProviderRates.map((rate: any) => [`${rate.model_id}:${rate.metric}`, rate]));
  const selectedMarkupPlans = Object.values(markups).filter(value => value.trim() !== '').length;

  return <div className={styles.root}>
    <header className={styles.header}>
      <div className={styles.heading}><h1 className={styles.title}>AI Usage &amp; Credits</h1><p className={styles.subtitle}>Monitor account availability, usage economics, and unresolved provider calls across businesses.</p></div>
      <div className={styles.headerActions}>
        <button className={styles.secondaryButton} onClick={exportCsv}><Download size={15} /><span>Export CSV</span></button>
        <button className={styles.iconButton} title="Refresh" aria-label="Refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button>
      </div>
    </header>

    <section className={styles.summaryGrid} aria-label="AI billing summary">
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Provider cost</div><div className={styles.summaryValue}>{money(totals.provider)}</div><div className={styles.summaryNote}>Recorded settlement cost</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Customer charges</div><div className={styles.summaryValue}>{money(totals.charged)}</div><div className={styles.summaryNote}>Across {rows.length} accounts</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Margin</div><div className={styles.summaryValue}>{money(totals.charged - totals.provider)}</div><div className={styles.summaryNote}>{totals.calls.toLocaleString()} provider calls</div></div>
      <div className={styles.summaryItem}><div className={styles.summaryLabel}>Needs review</div><div className={`${styles.summaryValue} ${totals.unknown ? styles.warning : ''}`}>{totals.unknown}</div><div className={styles.summaryNote}>Unknown reservations</div></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div className={styles.sectionHeader}>
        <div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>Business accounts</h2><p className={styles.sectionDescription}>Select a business to manage funding, enforcement, and cycle settings.</p></div>
        <div className={styles.filters}>
          <div className={styles.search}><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ai-muted)' }} /><input className={styles.input} style={{ paddingLeft: 31 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search businesses" aria-label="Search businesses" /></div></div>
          <select className={`${styles.select} ${styles.statusFilter}`} value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by enforcement"><option value="all">All statuses</option><option value="observe">Observe</option><option value="enforce">Enforce</option><option value="suspended">Suspended</option></select>
        </div>
      </div></div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Business</th><th>Plan</th><th>Status</th><th className={styles.numeric}>Available / used</th><th className={styles.numeric}>Reserved</th><th className={styles.numeric}>Provider cost</th><th className={styles.numeric}>Customer charge</th><th className={styles.numeric}>Margin</th><th className={styles.numeric}>Calls</th><th className={styles.numeric}>Unknown</th></tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.businessId} onClick={() => void open(row)}>
          <td><div className={styles.businessName}>{row.businessName}</div><div className={styles.businessId} title={row.businessId}>{row.businessId}</div></td>
          <td><strong>{title(row.planKey)}</strong><div className={styles.muted}>{title(row.fundingMode)}</div></td>
          <td><span className={`${styles.pill} ${styles[row.enforcementMode as 'observe'|'enforce'|'suspended'] || ''}`}>{row.enforcementMode}</span></td>
          <td className={styles.numeric}>{row.fundingMode === 'prepaid' ? money(row.balanceAud) : <>{money(row.usedAud)} <span className={styles.muted}>/ {money(row.limitAud)}</span></>}</td>
          <td className={styles.numeric}>{money(row.reservedAud)}</td><td className={styles.numeric}>{money(row.providerCostAud)}</td><td className={styles.numeric}>{money(row.tenantChargeAud)}</td><td className={styles.numeric}>{money(row.marginAud)}</td><td className={styles.numeric}>{row.calls.toLocaleString()}</td><td className={`${styles.numeric} ${row.unknownCalls ? styles.warning : ''}`}>{row.unknownCalls}</td>
        </tr>)}</tbody>
      </table>{!loading && visibleRows.length === 0 && <div className={styles.empty}>No accounts match the current filters.</div>}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div className={styles.sectionHeader}><div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>Rate cards</h2><p className={styles.sectionDescription}>Review Google account prices or create a manual effective rate. Historical rates remain unchanged.</p></div><button className={styles.secondaryButton} onClick={() => void previewGoogleRates()} disabled={googleLoading}><RefreshCw size={14} />{googleLoading ? 'Checking Google' : 'Sync Google rates'}</button></div></div>
      <div className={styles.rateBody}>
      <section className={styles.rateSection}>
        <div className={styles.rateSectionHeader}><div><strong>Active provider rates</strong><span>Loaded from the saved rate card whenever this page opens.</span></div><span className={styles.pill}>{activeProviderRates.length} active</span></div>
        {activeProviderRates.length > 0 ? <div className={styles.savedRatesWrap}><table className={styles.syncTable}><thead><tr><th>Model</th><th>Metric</th><th className={styles.numeric}>Provider cost</th><th>Source</th><th>Effective from</th></tr></thead><tbody>{activeProviderRates.map((rate: any) => <tr key={rate.id}><td><strong>{rate.model_id}</strong></td><td>{title(rate.metric)}</td><td className={styles.numeric}>{money(rate.priceAud)} <span className={styles.muted}>/ {Number(rate.unit_scale).toLocaleString()}</span></td><td className={styles.sku} title={rate.source_sku_id || rate.source_currency}>{rate.source_sku_id || rate.source_currency}</td><td>{new Date(rate.effective_from).toLocaleString('en-AU')}</td></tr>)}</tbody></table></div> : <div className={styles.syncEmpty}>No active provider rates are configured. Sync Google rates or add one manually.</div>}
      </section>

      <section className={styles.markupSection}>
        <div className={styles.rateSectionHeader}><div><strong>Plan markups</strong><span>Customer rate = active provider cost × (1 + markup percentage). Leave a plan blank to keep its current rates.</span></div></div>
        <div className={styles.markupGrid}>{Object.keys(markups).map(planKey => <Field key={planKey} label={title(planKey)}><div className={styles.percentageInput}><input className={styles.input} type="number" min="0" max="1000" step="0.01" inputMode="decimal" placeholder="Leave unchanged" value={markups[planKey]} onChange={event => setMarkups({ ...markups, [planKey]: event.target.value })} /><span>%</span></div></Field>)}</div>
        <div className={styles.rateFooter}><div className={styles.rateCount}>{selectedMarkupPlans ? `${activeProviderRates.length * selectedMarkupPlans} sell rates will be created across ${selectedMarkupPlans} plan${selectedMarkupPlans === 1 ? '' : 's'}` : 'Enter one or more plan percentages'}</div><button className={styles.primaryButton} disabled={markupLoading || !selectedMarkupPlans || !activeProviderRates.length} onClick={() => void applyPlanMarkups()}>{markupLoading ? 'Applying markups' : 'Apply plan markups'}</button></div>
      </section>

      <section className={styles.rateSection}>
        <div className={styles.rateSectionHeader}><div><strong>Active plan sell rates</strong><span>Customer rates currently applied to future AI usage. Editing creates a new effective rate and retains history.</span></div><div className={styles.rateSectionControls}><select className={styles.select} value={planRateFilter} onChange={event => setPlanRateFilter(event.target.value)} aria-label="Filter sell rates by plan"><option value="all">All plans</option>{['starter','core','scale','enterprise','platform'].map(planKey => <option key={planKey} value={planKey}>{title(planKey)}</option>)}</select><span className={styles.pill}>{visiblePlanRates.length} shown</span></div></div>
        {visiblePlanRates.length > 0 ? <div className={styles.savedRatesWrap}><table className={styles.syncTable}><thead><tr><th>Plan</th><th>Model</th><th>Metric</th><th className={styles.numeric}>Sell rate</th><th className={styles.numeric}>Markup</th><th>Effective from</th><th aria-label="Actions"></th></tr></thead><tbody>{visiblePlanRates.map((rate: any) => {
          const providerRate: any = providerRateByKey.get(`${rate.model_id}:${rate.metric}`);
          const markup = providerRate && Number(providerRate.priceAud) > 0 ? ((Number(rate.priceAud) / Number(providerRate.priceAud) - 1) * 100) : null;
          return <tr key={rate.id}><td><span className={styles.pill}>{title(rate.plan_key)}</span></td><td><strong>{rate.model_id}</strong></td><td>{title(rate.metric)}</td><td className={styles.numeric}>{money(rate.priceAud)} <span className={styles.muted}>/ {Number(rate.unit_scale).toLocaleString()}</span></td><td className={styles.numeric}>{markup == null ? '—' : `${markup.toFixed(2)}%`}</td><td>{new Date(rate.effective_from).toLocaleString('en-AU')}</td><td className={styles.numeric}><button className={styles.tableAction} title="Edit rate" onClick={() => editPlanRate(rate)}><Pencil size={13} />Edit</button></td></tr>;
        })}</tbody></table></div> : <div className={styles.syncEmpty}>{activePlanRates.length ? 'No active sell rates match this plan.' : 'No active plan sell rates are configured. Apply plan markups or add one manually.'}</div>}
      </section>

      {googlePreview && <div className={styles.syncPreview}>
        <div className={styles.syncHeader}><div><strong>Google Billing preview</strong><div className={styles.muted}>Fetched {new Date(googlePreview.fetchedAt).toLocaleString('en-AU')}. Prices are rechecked before activation.</div></div><button className={styles.primaryButton} disabled={googleLoading || !googleSelected.length} onClick={() => void approveGoogleRates()}>{googleSelected.length ? `Approve ${googleSelected.length} selected` : 'No changes to approve'}</button></div>
        <div className={`${styles.syncStatus} ${googleSelected.length ? styles.syncStatusAction : styles.syncStatusCurrent}`}>
          <strong>{googleSelected.length ? `${googleSelected.length} supported rate${googleSelected.length === 1 ? '' : 's'} ready for approval` : `${googlePreview.candidates.length} supported Google rate${googlePreview.candidates.length === 1 ? '' : 's'} active and current`}</strong>
          <span>{googleSelected.length ? 'Review the selected changes before activation.' : 'Every supported Google price matches the active provider rate.'}</span>
        </div>
        {googlePreview.candidates.length > 0 ? <div className={styles.syncTableWrap}><table className={styles.syncTable}><thead><tr><th aria-label="Select rate"></th><th>Model</th><th>Metric</th><th className={styles.numeric}>Current</th><th className={styles.numeric}>Google</th><th>Status</th><th>Google SKU</th></tr></thead><tbody>{googlePreview.candidates.map((candidate: any) => <tr key={candidate.id}>
          <td>{candidate.status === 'unchanged' ? <span className={styles.activeRate} title="Already active" aria-label="Already active"><Check size={14} /></span> : <input type="checkbox" aria-label={`Select ${candidate.modelId} ${candidate.metric}`} checked={googleSelected.includes(candidate.id)} onChange={event => setGoogleSelected(event.target.checked ? [...googleSelected, candidate.id] : googleSelected.filter(id => id !== candidate.id))} />}</td>
          <td><strong>{candidate.modelId}</strong></td><td>{title(candidate.metric)}</td><td className={styles.numeric}>{candidate.currentPriceAud == null ? 'Not set' : money(candidate.currentPriceAud)}</td><td className={styles.numeric}>{money(candidate.priceAud)} <span className={styles.muted}>/ {candidate.unitScale.toLocaleString()}</span></td><td><span className={`${styles.pill} ${styles[candidate.status] || ''}`}>{candidate.status}</span></td><td className={styles.sku} title={candidate.skuName}>{candidate.skuId}</td>
        </tr>)}</tbody></table></div> : <div className={styles.syncEmpty}>Google returned no standard token rates that can be represented safely.</div>}
        {googlePreview.warnings.length > 0 && <details className={styles.syncWarnings}><summary>{googlePreview.warnings.length} Google SKU mapping{googlePreview.warnings.length === 1 ? '' : 's'} excluded from automatic rates</summary>{googlePreview.warnings.map((warning: any, index: number) => <div className={styles.warningRow} key={`${warning.skuId}-${index}`}><strong>{warning.skuName}</strong><span>{warning.reason}</span><code>{warning.skuId}</code></div>)}</details>}
      </div>}
      <div id="manual-rate-editor" className={styles.manualRateHeading}><strong>{editingRateLabel ? 'Edit sell rate' : 'Manual effective rate'}</strong><span>{editingRateLabel || 'Use for plan sell rates or unsupported Google pricing shapes.'}</span></div><div className={styles.rateGrid}>
        <Field label="Rate type"><select className={styles.select} value={rateForm.kind} onChange={event => { setEditingRateLabel(''); setRateForm({ ...rateForm, kind: event.target.value }); }}><option value="provider">Provider cost</option><option value="plan">Plan sell rate</option></select></Field>
        {rateForm.kind === 'plan' && <Field label="Plan"><select className={styles.select} value={rateForm.planKey} onChange={event => setRateForm({ ...rateForm, planKey: event.target.value })}>{['starter','core','scale','enterprise','platform'].map(value => <option key={value}>{title(value)}</option>)}</select></Field>}
        <Field label="Model ID" wide><input className={styles.input} placeholder="gemini-2.5-flash" value={rateForm.modelId} onChange={event => setRateForm({ ...rateForm, modelId: event.target.value })} /></Field>
        <Field label="Metric"><select className={styles.select} value={rateForm.metric} onChange={event => setRateForm({ ...rateForm, metric: event.target.value })}>{['input_tokens','cached_input_tokens','output_tokens','thinking_tokens','output_image','video_second'].map(value => <option key={value} value={value}>{title(value)}</option>)}</select></Field>
        <Field label="AUD price"><input className={styles.input} inputMode="decimal" placeholder="0.00" value={rateForm.priceAud} onChange={event => setRateForm({ ...rateForm, priceAud: event.target.value })} /></Field>
        {rateForm.kind === 'provider' && <><Field label="Source price"><input className={styles.input} inputMode="decimal" placeholder="0.00" value={rateForm.sourcePriceDecimal} onChange={event => setRateForm({ ...rateForm, sourcePriceDecimal: event.target.value })} /></Field><Field label="AUD exchange rate"><input className={styles.input} inputMode="decimal" placeholder="1.00" value={rateForm.audFxRate} onChange={event => setRateForm({ ...rateForm, audFxRate: event.target.value })} /></Field></>}
        <Field label="Effective from"><input className={styles.input} type="datetime-local" value={rateForm.effectiveFrom} onChange={event => setRateForm({ ...rateForm, effectiveFrom: event.target.value })} /></Field>
      </div><div className={styles.rateFooter}><div className={styles.rateCount}>{activeProviderRates.length} active provider rates · {activePlanRates.length} active plan rates</div><button className={styles.primaryButton} onClick={() => void addRate()}>{editingRateLabel ? 'Save new effective rate' : 'Add effective rate'}</button></div>
      {message && !selected && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}</div>
    </section>

    {selected && <div className={styles.backdrop} onClick={() => setSelected(null)}><aside className={styles.drawer} aria-label={`${selected.businessName} AI account`} onClick={event => event.stopPropagation()}>
      <div className={styles.drawerHeader}><div className={styles.drawerTitle}><h2>{selected.businessName}</h2><p>{selected.businessId}</p></div><button className={styles.iconButton} title="Close" aria-label="Close" onClick={() => setSelected(null)}><X size={16} /></button></div>
      <div className={styles.drawerBody}>{!detail ? <div className={styles.empty}>Loading account…</div> : <>
        <section className={styles.drawerSection}><h3>Account configuration</h3><div className={styles.formGrid}>
          <Field label="Plan"><div className={styles.readOnlyValue}>{title(form.planKey)}<span>Manage in Business Settings</span></div></Field>
          <Field label="Funding"><select className={styles.select} value={form.fundingMode} onChange={event => setForm({ ...form, fundingMode: event.target.value })}><option value="prepaid">Prepaid</option><option value="account_limit">Account limit</option></select></Field>
          <Field label="Enforcement"><select className={styles.select} value={form.enforcementMode} onChange={event => setForm({ ...form, enforcementMode: event.target.value })}>{['observe','enforce','suspended'].map(value => <option key={value}>{title(value)}</option>)}</select></Field>
          <Field label="Reset policy"><select className={styles.select} value={form.cycleMode} onChange={event => setForm({ ...form, cycleMode: event.target.value })}>{['calendar_month','billing_anniversary','manual'].map(value => <option key={value} value={value}>{title(value)}</option>)}</select></Field>
          <Field label="Limit (AUD)"><input className={styles.input} value={form.limitAud} onChange={event => setForm({ ...form, limitAud: event.target.value })} /></Field>
          <Field label="Cycle day"><input className={styles.input} type="number" min="1" max="31" value={form.cycleAnchorDay} onChange={event => setForm({ ...form, cycleAnchorDay: Number(event.target.value) })} /></Field>
          <Field label="Change reason" wide><input className={styles.input} value={form.reason || ''} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Required audit note" /></Field>
        </div><div className={styles.drawerActions}><button className={styles.primaryButton} onClick={() => void command(form)}>Save configuration</button></div></section>

        <CreditAdjustment onApply={body => void command(body)} />

        <section className={styles.drawerSection}><h3>Cycle controls</h3><p className={styles.sectionDescription}>A manual reset clears cycle usage but keeps unresolved reservations held.</p><div className={styles.drawerActions}><button className={styles.secondaryButton} onClick={() => { const reason = window.prompt('Reason for resetting this account cycle?'); if (reason) void command({ command: 'reset_cycle', reason }); }}>Reset cycle</button></div></section>

        {detail.recentCalls.some((call: any) => call.status === 'unknown') && <section className={styles.drawerSection}><h3>Unknown reservations</h3>{detail.recentCalls.filter((call: any) => call.status === 'unknown').map((call: any) => <div className={styles.unknownRow} key={call.id}><div className={styles.unknownDetails}><strong>Call #{call.id}</strong><div className={styles.muted}>{title(call.operation)} · {call.model_id}</div></div><button className={styles.dangerButton} onClick={() => { const reason = window.prompt('Evidence or reason for releasing this reservation?'); if (reason) void command({ command: 'release_unknown', callId: call.id, reason }); }}>Release</button></div>)}</section>}
        {message && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}
      </>}</div>
    </aside></div>}
  </div>;
}

function CreditAdjustment({ onApply }: { onApply: (body: Record<string, unknown>) => void }) {
  const [amount, setAmount] = useState(''); const [reference, setReference] = useState(''); const [reason, setReason] = useState('');
  return <section className={styles.drawerSection}><h3>Prepaid credit adjustment</h3><div className={styles.formGrid}>
    <Field label="Signed amount (AUD)"><input className={styles.input} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="250.00 or -25.00" /></Field>
    <Field label="Payment / reference"><input className={styles.input} value={reference} onChange={event => setReference(event.target.value)} /></Field>
    <Field label="Adjustment reason" wide><input className={styles.input} value={reason} onChange={event => setReason(event.target.value)} placeholder="Required audit reason" /></Field>
  </div><div className={styles.drawerActions}><button className={styles.primaryButton} onClick={() => onApply({ command: 'adjust_credit', amountAud: amount, externalReference: reference, reason, idempotencyKey: crypto.randomUUID() })}>Apply adjustment</button></div></section>;
}