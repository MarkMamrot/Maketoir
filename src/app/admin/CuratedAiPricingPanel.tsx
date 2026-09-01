'use client';

import { useEffect, useState } from 'react';
import { Check, RefreshCw, Save } from 'lucide-react';

import styles from './AiUsageCreditsDashboard.module.css';

type ExpectedRate = { metric: string; usdPrice: string; unitScale: number; audPrice: string };
type CuratedModel = { id: string; name: string; role: string; pricingNote?: string; reviewAfter?: string; allowed: boolean; currentMatches: boolean; expected: ExpectedRate[] };
type Pricing = { audPerUsd: string; fxUpdatedAt: string | null; markups: Record<string, string>; models: CuratedModel[]; current: boolean };

const PLAN_KEYS = ['starter', 'core', 'scale', 'enterprise', 'platform'];
const title = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
const decimal = (value: string, maximumFractionDigits = 6) => new Intl.NumberFormat('en-AU', { maximumFractionDigits }).format(Number(value));
const metricUnit = (rate: ExpectedRate) => rate.metric === 'video_second' ? 'second' : rate.unitScale === 1_000_000 ? '1M tokens' : rate.unitScale.toLocaleString('en-AU');

export default function CuratedAiPricingPanel() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [audPerUsd, setAudPerUsd] = useState('');
  const [markups, setMarkups] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/ai-billing/rates/curated');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI pricing could not be loaded.');
      setPricing(result); setAudPerUsd(result.audPerUsd); setMarkups(result.markups || {}); setIsError(false);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'AI pricing could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true); setMessage(''); setIsError(false);
    try {
      const response = await fetch('/api/admin/ai-billing/rates/curated', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audPerUsd, markups }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI pricing could not be saved.');
      await load();
      setMessage(`Pricing applied to ${result.models} models and ${result.plans} plans.`);
    } catch (error) { setIsError(true); setMessage(error instanceof Error ? error.message : 'AI pricing could not be saved.'); }
    finally { setSaving(false); }
  };

  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div className={styles.sectionHeader}>
      <div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>AI pricing</h2><p className={styles.sectionDescription}>Six supported Google models, converted to AUD and sold at each plan&apos;s markup.</p></div>
      <div className={styles.headerActions}>{pricing?.current && <span className={`${styles.pill} ${styles.unchanged}`}><Check size={12} /> Current</span>}<button className={styles.iconButton} title="Refresh pricing" aria-label="Refresh pricing" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button></div>
    </div></div>
    <div className={styles.rateBody}>
      <div className={styles.pricingControls}>
        <div className={styles.fxControl}><label htmlFor="aud-per-usd">AUD per USD</label><input id="aud-per-usd" className={styles.input} inputMode="decimal" value={audPerUsd} onChange={event => setAudPerUsd(event.target.value)} /><span>Used to convert published Google USD prices.</span></div>
        <div className={styles.markupGrid}>{PLAN_KEYS.map(planKey => <div className={styles.planPricingControl} key={planKey}><label htmlFor={`markup-${planKey}`}>{title(planKey)}</label><div className={styles.percentageInput}><input id={`markup-${planKey}`} className={styles.input} type="number" min="0" max="1000" step="0.01" value={markups[planKey] ?? ''} onChange={event => setMarkups({ ...markups, [planKey]: event.target.value })} /><span>%</span></div></div>)}</div>
      </div>
      {loading && !pricing ? <div className={styles.empty}>Loading AI pricing...</div> : <div className={styles.curatedModelList}>{pricing?.models.map(model => <article className={styles.curatedModel} key={model.id}>
        <div className={styles.curatedModelHeader}><div><strong>{model.name}</strong><span>{model.role}</span><code>{model.id}</code></div><span className={`${styles.pill} ${model.allowed && model.currentMatches ? styles.unchanged : styles.changed}`}>{model.allowed && model.currentMatches ? 'Active' : 'Apply required'}</span></div>
        <div className={styles.curatedRates}>{model.expected.map(rate => <div className={styles.curatedRate} key={rate.metric}><span>{title(rate.metric)}</span><strong>US${decimal(rate.usdPrice)} / {metricUnit(rate)}</strong><small>A${decimal(rate.audPrice)} / {metricUnit(rate)}</small></div>)}</div>
        {(model.pricingNote || model.reviewAfter) && <p className={styles.pricingNote}>{model.pricingNote}{model.reviewAfter ? ` Review by ${new Date(`${model.reviewAfter}T00:00:00`).toLocaleDateString('en-AU')}.` : ''}</p>}
      </article>)}</div>}
      <div className={styles.rateFooter}><div className={styles.rateCount}>Google returns usage quantities, not a dollar total. Solvantis calculates each settled call from these active costs, then applies the plan markup.</div><button className={styles.primaryButton} disabled={saving || loading} onClick={() => void save()}><Save size={14} />{saving ? 'Applying pricing' : 'Apply pricing'}</button></div>
      {message && <div className={`${styles.message} ${isError ? styles.error : ''}`}>{message}</div>}
    </div>
  </section>;
}