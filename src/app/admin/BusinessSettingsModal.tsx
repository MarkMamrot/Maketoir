'use client';

import { useEffect, useRef, useState } from 'react';
import {
  billingAmountCents, validateBillingEntries, validatePlanStartDate,
  type BusinessBillingData, type BusinessBillingEntry,
} from '@/lib/admin/businessBilling';
import { BusinessBillingHistory } from './BusinessBillingHistory';
import styles from './BusinessSettings.module.css';

interface SettingsBusiness {
  business_id: string; name: string;
  has_foresight: number; has_ims: number; has_pos: number;
  is_sandbox: number; automation_paused: number;
  max_locations: number | null; max_users: number | null; cost_per_location: number | null;
}
interface AiAccount {
  planKey: string; fundingMode: string; enforcementMode: string;
  cycleMode: string; cycleAnchorDay: number; cycleTimezone: string;
  limitAud: string; warningPercent: number;
}
type Tab = 'general' | 'plan' | 'history';
const tabs: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' }, { id: 'plan', label: 'Plan & Billing' }, { id: 'history', label: 'History' },
];

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || 'Settings could not be saved or loaded.');
  return data;
}

export function BusinessSettingsModal({ biz, onClose, onSaved }: {
  biz: SettingsBusiness; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('general');
  const initialForm = {
    name: biz.name, has_foresight: !!biz.has_foresight, has_ims: !!biz.has_ims, has_pos: !!biz.has_pos,
    is_sandbox: !!biz.is_sandbox, automation_paused: !!biz.automation_paused,
    max_locations: biz.max_locations == null ? '' : String(biz.max_locations),
    max_users: biz.max_users == null ? '' : String(biz.max_users),
    cost_per_location: biz.cost_per_location == null ? '' : String(biz.cost_per_location),
  };
  const [form, setForm] = useState(initialForm);
  const [aiAccount, setAiAccount] = useState<AiAccount | null>(null);
  const [aiPlanKey, setAiPlanKey] = useState('starter');
  const [billing, setBilling] = useState<BusinessBillingData | null>(null);
  const [savedBilling, setSavedBilling] = useState<BusinessBillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const changedEntries = (billing?.entries ?? []).filter(entry => {
    const saved = savedBilling?.entries.find(row => row.month === entry.month);
    return !saved || entry.paymentPlan !== saved.paymentPlan || entry.amountAud !== saved.amountAud || entry.paid !== saved.paid;
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm) || aiPlanKey !== (aiAccount?.planKey ?? 'starter')
    || billing?.planStartDate !== savedBilling?.planStartDate || changedEntries.length > 0;
  const close = () => {
    if (!saving && (!dirty || window.confirm('Discard unsaved Business Settings changes?'))) onClose();
  };

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setLoaded(false);
    Promise.all([
      fetch(`/api/admin/ai-billing/${encodeURIComponent(biz.business_id)}`).then(response => readResponse<{ account: AiAccount }>(response)),
      fetch(`/api/admin/businesses/${encodeURIComponent(biz.business_id)}/billing`, { cache: 'no-store' })
        .then(response => readResponse<{ billing: BusinessBillingData }>(response)),
    ]).then(([ai, result]) => {
      if (!active) return;
      setAiAccount(ai.account); setAiPlanKey(ai.account.planKey);
      setBilling(result.billing); setSavedBilling(result.billing); setLoaded(true);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Business Settings could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [biz.business_id, loadVersion]);

  const save = async () => {
    if (!billing || !savedBilling || !loaded || saving) return;
    setSaving(true); setError('');
    const savedParts: string[] = [];
    try {
      if (!form.name.trim()) throw new Error('Business name is required.');
      for (const value of [form.max_locations, form.max_users]) {
        if (value.trim() && (!Number.isSafeInteger(Number(value)) || Number(value) < 1)) throw new Error('Location and user limits must be positive whole numbers or blank.');
      }
      if (form.cost_per_location.trim()) billingAmountCents(form.cost_per_location);
      const planStartDate = validatePlanStartDate(billing.planStartDate);
      const entries = validateBillingEntries(changedEntries);
      await readResponse(await fetch(`/api/admin/businesses/${encodeURIComponent(biz.business_id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, name: form.name.trim(),
          max_locations: form.max_locations.trim() ? Number(form.max_locations) : null,
          max_users: form.max_users.trim() ? Number(form.max_users) : null,
          cost_per_location: form.cost_per_location.trim() ? Number(form.cost_per_location) : null,
        }),
      }));
      savedParts.push('Business details and limits');
      if (planStartDate !== savedBilling.planStartDate || entries.length) {
        const result = await readResponse<{ billing: BusinessBillingData }>(await fetch(`/api/admin/businesses/${encodeURIComponent(biz.business_id)}/billing`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planStartDate, expectedPlanStartDate: savedBilling.planStartDate, entries }),
        }));
        setBilling(result.billing); setSavedBilling(result.billing);
        savedParts.push('Plan start date and payment history');
      }
      if (aiAccount && aiPlanKey !== aiAccount.planKey) {
        await readResponse(await fetch(`/api/admin/ai-billing/${encodeURIComponent(biz.business_id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'configure', idempotencyKey: crypto.randomUUID(), reason: 'Plan changed in Business Settings',
            planKey: aiPlanKey, fundingMode: aiAccount.fundingMode, enforcementMode: aiAccount.enforcementMode,
            cycleMode: aiAccount.cycleMode, cycleAnchorDay: aiAccount.cycleAnchorDay,
            cycleTimezone: aiAccount.cycleTimezone, limitAud: aiAccount.limitAud, warningPercent: aiAccount.warningPercent,
          }),
        }));
      }
      onSaved(); onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Business Settings could not be saved.';
      setError(`${savedParts.length ? `${savedParts.join('; ')} saved. Remaining changes were not confirmed. ` : ''}${message}`);
      if (savedParts.length) onSaved();
    } finally { setSaving(false); }
  };
  const updateEntry = (entry: BusinessBillingEntry) => setBilling(previous => previous ? ({
    ...previous, entries: [...previous.entries.filter(row => row.month !== entry.month), entry],
  }) : previous);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="business-settings-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.header}>
      <h2 id="business-settings-title">Business Settings — {biz.name}</h2>
      <div role="tablist" aria-label="Business Settings sections" className={styles.tabs}
        onKeyDown={event => {
          const index = tabs.findIndex(item => item.id === tab);
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next >= 0) {
            event.preventDefault(); setTab(tabs[next].id);
            dialog.current?.querySelector<HTMLButtonElement>(`#business-tab-${tabs[next].id}`)?.focus();
          }
        }}>
        {tabs.map(item => <button key={item.id} id={`business-tab-${item.id}`} type="button" role="tab"
          aria-selected={tab === item.id} aria-controls={`business-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
          onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>
    </header>
    <div className={styles.body} role="tabpanel" id={`business-panel-${tab}`} aria-labelledby={`business-tab-${tab}`}>
      <fieldset disabled={saving} className={styles.form}>
        {tab === 'general' && <>
          <label>Business name<input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label>
          <h3>Module access</h3>
          {([{ key: 'has_ims', label: 'IMS (Inventory Management)' }, { key: 'has_pos', label: 'POS (Point of Sale)' }] as const).map(item =>
            <label key={item.key} className={styles.check}><input type="checkbox" checked={form[item.key]}
              onChange={event => setForm(previous => ({ ...previous, [item.key]: event.target.checked }))} />{item.label}</label>)}
          <h3>Environment safety</h3>
          <label className={styles.check}><input type="checkbox" checked={form.is_sandbox} onChange={event => setForm(previous => ({ ...previous, is_sandbox: event.target.checked }))} />Sandbox tenant</label>
          <label className={styles.check}><input type="checkbox" checked={form.automation_paused} onChange={event => setForm(previous => ({ ...previous, automation_paused: event.target.checked }))} />Pause scheduled automation</label>
          <p>Shared cron jobs skip paused businesses; manual actions remain available.</p>
        </>}
        {tab === 'plan' && <>
          <h3>Plan &amp; Billing</h3>
          <label>Plan start date<input type="date" value={billing?.planStartDate ?? ''} disabled={!loaded}
            onChange={event => setBilling(previous => previous ? { ...previous, planStartDate: event.target.value || null } : previous)} /></label>
          <p>This date determines which calendar months appear in History. It does not automatically calculate charges.</p>
          <label>Solvantis AI plan<select value={aiPlanKey} disabled={!loaded || !aiAccount} onChange={event => setAiPlanKey(event.target.value)}>
            <option value="starter">Starter</option><option value="core">Core</option><option value="scale">Scale</option><option value="enterprise">Enterprise</option>
            {biz.business_id === '__solvantis_platform__' && <option value="platform">Solvantis Platform</option>}
          </select></label>
          <div className={styles.limits}>
            <label>Max locations<input type="number" min={1} step={1} value={form.max_locations} placeholder="Unlimited" onChange={event => setForm(previous => ({ ...previous, max_locations: event.target.value }))} /></label>
            <label>Max users<input type="number" min={1} step={1} value={form.max_users} placeholder="Unlimited" onChange={event => setForm(previous => ({ ...previous, max_users: event.target.value }))} /></label>
            <label>Cost / location (AUD/month)<input type="text" inputMode="decimal" value={form.cost_per_location} placeholder="Not set" onChange={event => setForm(previous => ({ ...previous, cost_per_location: event.target.value }))} /></label>
          </div>
          <p>Blank limits mean unlimited. Limits are enforced when creating locations or inviting users. Monthly payment records are entered separately in History.</p>
        </>}
        {tab === 'history' && (billing
          ? <BusinessBillingHistory planStartDate={billing.planStartDate} entries={billing.entries} onChange={updateEntry} disabled={saving || !loaded} />
          : <p>Payment history is not loaded.</p>)}
      </fieldset>
      {loading && <p role="status">Loading plan and payment history...</p>}
    </div>
    <footer className={styles.footer}>
      {error && <p role="alert">{error}</p>}
      {!loading && !loaded && <button type="button" onClick={() => setLoadVersion(value => value + 1)}>Retry loading</button>}
      <button type="button" onClick={close} disabled={saving}>Cancel</button>
      <button type="button" className={styles.save} onClick={() => void save()} disabled={saving || loading || !loaded}>{saving ? 'Saving...' : 'Save Changes'}</button>
    </footer>
  </dialog>;
}
