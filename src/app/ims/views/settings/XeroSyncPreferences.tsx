'use client';

import { useEffect, useState } from 'react';
import { parseXeroDocumentPolicy, type XeroDocumentPolicy } from '@/lib/xero/documentPolicies';
import type { CogsFrequency } from '@/lib/xero/cogsPeriods';
import { SettingsActions, useSettingsDirty } from './SettingsShell';
import styles from './XeroSyncPreferences.module.css';

export const XERO_PREFERENCES_UPDATED_EVENT = 'solvantis:xero-preferences-updated';

interface CogsSettings {
  enabled: boolean;
  frequency: CogsFrequency;
  reliableFrom: string | null;
  nextPeriodStart: string | null;
  heldReason: string | null;
  heldPeriodStart: string | null;
}

export function XeroSyncPreferences({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const [policy, setPolicy] = useState<XeroDocumentPolicy | null>(null);
  const [savedPolicy, setSavedPolicy] = useState<XeroDocumentPolicy | null>(null);
  const [cogs, setCogs] = useState<CogsSettings | null>(null);
  const [savedCogs, setSavedCogs] = useState<CogsSettings | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState<'policy' | 'cogs' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const policyDirty = JSON.stringify(policy) !== JSON.stringify(savedPolicy);
  const cogsDirty = JSON.stringify(cogs) !== JSON.stringify(savedCogs);
  useSettingsDirty(policyDirty || cogsDirty || saving !== null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    setPolicy(null); setSavedPolicy(null); setCogs(null); setSavedCogs(null);
    Promise.all([
      fetch(`/api/xero/document-policies?databaseId=${encodeURIComponent(businessId)}`).then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load posting preferences.');
        return parseXeroDocumentPolicy(data.policy);
      }),
      fetch(`/api/xero/cogs/settings?databaseId=${encodeURIComponent(businessId)}`).then(async response => {
        const data = await response.json();
        if (!response.ok || !data.settings || data.warning) throw new Error(data.error || 'Unable to load Sales COGS settings.');
        return data.settings as CogsSettings;
      }),
      fetch(`/api/xero/status?databaseId=${encodeURIComponent(businessId)}`).then(async response => {
        const data = await response.json();
        if (!response.ok || typeof data.connected !== 'boolean') throw new Error(data.error || 'Unable to load Xero connection status.');
        return data.connected as boolean;
      }),
    ]).then(([loadedPolicy, loadedCogs, isConnected]) => {
      if (cancelled) return;
      setPolicy(loadedPolicy); setSavedPolicy(loadedPolicy);
      setCogs(loadedCogs); setSavedCogs(loadedCogs); setConnected(isConnected);
    }).catch(cause => {
      if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Unable to load Xero preferences.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, revision]);

  const savePolicy = async () => {
    if (!policy || !savedPolicy) return;
    setSaving('policy'); setError(''); setMessage('');
    try {
      // Read the current full policy so these two controls cannot overwrite unrelated sync rules.
      const currentResponse = await fetch(`/api/xero/document-policies?databaseId=${encodeURIComponent(businessId)}`);
      const current = await currentResponse.json();
      if (!currentResponse.ok || !current.success) throw new Error(current.error || 'Unable to refresh posting preferences.');
      const merged = {
        ...parseXeroDocumentPolicy(current.policy),
        ...(policy.postingEnabled !== savedPolicy.postingEnabled ? { postingEnabled: policy.postingEnabled } : {}),
        ...(policy.stocktakeJournalEnabled !== savedPolicy.stocktakeJournalEnabled ? { stocktakeJournalEnabled: policy.stocktakeJournalEnabled } : {}),
      };
      const response = await fetch('/api/xero/document-policies', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: businessId, policy: merged }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save posting preferences.');
      const saved = parseXeroDocumentPolicy(data.policy);
      setPolicy(saved); setSavedPolicy(saved); setMessage('Posting preferences saved.');
      window.dispatchEvent(new Event(XERO_PREFERENCES_UPDATED_EVENT));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save posting preferences.');
    } finally { setSaving(null); }
  };

  const saveCogs = async () => {
    if (!cogs) return;
    setSaving('cogs'); setError(''); setMessage('');
    try {
      const response = await fetch('/api/xero/cogs/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: businessId, enabled: cogs.enabled, frequency: cogs.frequency, reliableFrom: cogs.reliableFrom }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save Sales COGS settings.');
      setSavedCogs(cogs); setMessage('Sales COGS schedule saved.');
      window.dispatchEvent(new Event(XERO_PREFERENCES_UPDATED_EVENT));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save Sales COGS settings.');
    } finally { setSaving(null); }
  };

  const disabled = !canManage || loading || saving !== null || Boolean(loadError);
  return <section className={styles.panel} aria-label="Xero sync preferences">
    <header className={styles.heading}><div><h2>Sync preferences</h2><p>Choose what Solvantis sends to Xero. These choices are saved separately from your connection.</p></div>
      {connected !== null && !loadError && <span className={styles.badge}>{connected ? 'Connected' : 'Not connected'}</span>}
    </header>
    {!canManage && <p className={styles.notice}>Only Admins and SuperAdmins can change these preferences.</p>}
    {loading && <p role="status">Loading Xero preferences...</p>}
    {loadError && <div role="alert"><p>{loadError}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry loading preferences</button></div>}
    {policy && cogs && <>
      {connected === false && <p className={styles.notice}>You can save preferences before connecting. Disconnecting does not reset them. If posting is on, an unfinished Xero post still needs attention.</p>}
      <div className={styles.cards}>
        <section className={styles.card} aria-label="Posting and stocktake adjustments">
          <h3>Posting &amp; stocktake adjustments</h3>
          <label className={styles.toggle}><span><strong>Allow posting to Xero</strong><small>Master switch for all Xero posting, including Sales COGS.</small></span>
            <input type="checkbox" role="switch" checked={policy.postingEnabled} disabled={disabled} onChange={event => { setPolicy({ ...policy, postingEnabled: event.target.checked }); setMessage(''); }} />
          </label>
          <label className={styles.toggle}><span><strong>Stocktake adjustments</strong><small>Post inventory adjustment journals after a stocktake completes. Separate from Sales COGS.</small></span>
            <input type="checkbox" role="switch" checked={policy.stocktakeJournalEnabled} disabled={disabled} onChange={event => { setPolicy({ ...policy, stocktakeJournalEnabled: event.target.checked }); setMessage(''); }} />
          </label>
          {!policy.postingEnabled && <p className={styles.notice}>Posting is paused. Stocktakes still complete locally without a Xero warning.</p>}
          {policy.postingEnabled && !policy.stocktakeJournalEnabled && <p className={styles.notice}>Stocktake adjustments stay in Solvantis; no automatic Xero journal is attempted.</p>}
          <SettingsActions><button type="button" data-primary disabled={disabled || !policyDirty} onClick={() => void savePolicy()}>{saving === 'policy' ? 'Saving...' : 'Save posting preferences'}</button>
            <button type="button" disabled={disabled || !policyDirty} onClick={() => { setPolicy(savedPolicy); setError(''); setMessage(''); }}>Cancel posting changes</button></SettingsActions>
        </section>
        <section className={styles.card} aria-label="Sales COGS schedule">
          <h3>Sales COGS</h3>
          <label className={styles.toggle}><span><strong>Automatic Sales COGS</strong><small>Post eligible sales costs after each completed calendar period. This does not control stocktake journals.</small></span>
            <input type="checkbox" role="switch" checked={cogs.enabled} disabled={disabled} onChange={event => { setCogs({ ...cogs, enabled: event.target.checked }); setMessage(''); }} />
          </label>
          <div className={styles.fields}>
            <label>Frequency<select value={cogs.frequency} disabled={disabled || Boolean(cogs.heldReason)} onChange={event => setCogs({ ...cogs, frequency: event.target.value as CogsFrequency })}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
            </select></label>
            <label>First reliable COGS date<input type="date" value={cogs.reliableFrom ?? ''} disabled={disabled || Boolean(cogs.heldReason)} onChange={event => setCogs({ ...cogs, reliableFrom: event.target.value || null })} /></label>
          </div>
          {cogs.heldReason && <p className={styles.notice}>Schedule held: {cogs.heldReason}. Review {cogs.heldPeriodStart || 'the held period'} in COGS Reconciliation before changing or resuming it.</p>}
          {cogs.enabled && !cogs.reliableFrom && <p role="alert">Set the first reliable COGS date before enabling automatic sync.</p>}
          <SettingsActions><button type="button" data-primary disabled={disabled || !cogsDirty || (cogs.enabled && !cogs.reliableFrom)} onClick={() => void saveCogs()}>{saving === 'cogs' ? 'Saving...' : 'Save Sales COGS schedule'}</button>
            <button type="button" disabled={disabled || !cogsDirty} onClick={() => { setCogs(savedCogs); setError(''); setMessage(''); }}>Cancel COGS changes</button></SettingsActions>
        </section>
      </div>
      <p className={styles.notice}>Allowing posting also resumes other enabled workflows in Sync Rules. Saving preferences does not connect Xero, post historical stocktakes, or replace required account mappings. After reconnecting, retry only the outstanding accounting action.</p>
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
