'use client';

import React, { useEffect, useState } from 'react';
import { ConnectionsTab, type ConnectionProvider } from '../../../setup/page';
import type { SettingsSection } from '@/lib/navigation/imsSettingsNavigation';
import { useSettingsDirty } from './SettingsShell';
import styles from './IntegrationSettingsSection.module.css';

type OptionalProvider = Exclude<ConnectionProvider, 'xero'>;
type Availability = { enabled: boolean; configured: boolean };
type AvailabilityResponse = {
  success: boolean;
  businessId: string;
  integrations: Record<OptionalProvider, Availability>;
  canManage: boolean;
  error?: string;
};

const PROVIDERS: { id: OptionalProvider; label: string; purpose: string; section: SettingsSection; impact: string }[] = [
  { id: 'cin7', label: 'Cin7 Omni', purpose: 'Inventory, contacts and historical imports.', section: 'connection-cin7', impact: 'Cin7 imports and dependent sync will pause. Existing stock and order records are retained.' },
  { id: 'google', label: 'Google Ads & Analytics', purpose: 'Advertising and website performance information.', section: 'connection-google', impact: 'Google-dependent monitoring and automation will pause. Your authorisation and account selections are retained.' },
  { id: 'meta', label: 'Meta Ads', purpose: 'Advertising information and supported marketing workflows.', section: 'connection-meta', impact: 'Meta-dependent monitoring and automation will pause. Your authorisation and account selection are retained.' },
  { id: 'klaviyo', label: 'Klaviyo', purpose: 'Marketing information and controlled customer/commerce sync.', section: 'connection-klaviyo', impact: 'Klaviyo analysis and customer/commerce delivery will pause. Saved source selections and previously delivered events are retained.' },
  { id: 'gmail', label: 'Gmail', purpose: 'Connected mailbox and customer-service workflows.', section: 'connection-gmail', impact: 'Gmail-dependent mailbox and customer-service activity will pause. Other transactional email is unaffected.' },
];

export function IntegrationSettingsSection({ businessId, businessName, provider, onNavigate, onHelp, xeroEnabled, saveXeroEnabled, children }: {
  businessId: string; businessName: string; provider?: ConnectionProvider; onNavigate: (section: SettingsSection) => void;
  onHelp: (context: string) => void; xeroEnabled: boolean; saveXeroEnabled: (enabled: boolean) => Promise<void>; children?: React.ReactNode;
}) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const [xeroSaved, setXeroSaved] = useState(xeroEnabled);
  const [message, setMessage] = useState('');
  const descriptor = PROVIDERS.find(item => item.id === provider);
  const availability = provider === 'xero' ? { enabled: xeroSaved, configured: false } : provider ? data?.integrations[provider] : undefined;
  const dirty = draftEnabled !== null && draftEnabled !== availability?.enabled;
  useSettingsDirty(provider !== 'xero' && dirty);

  useEffect(() => { setXeroSaved(xeroEnabled); }, [xeroEnabled]);
  useEffect(() => {
    let current = true;
    setData(null); setError(''); setDraftEnabled(null);
    fetch('/api/ims/integrations', { cache: 'no-store' }).then(async response => {
      const body: AvailabilityResponse = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Integration availability could not be loaded.');
      if (body.businessId !== businessId) throw new Error('The active business changed. Reopen Settings for the intended business.');
      if (current) setData(body);
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : 'Integration availability could not be loaded.'); });
    return () => { current = false; };
  }, [businessId, version]);

  const save = async (enabled = draftEnabled) => {
    if (!provider || enabled === null || saving) return;
    if (!enabled && !window.confirm(`${provider === 'xero' ? 'New accounting sync and posting will pause. Existing accounting records and credentials are retained.' : descriptor?.impact}\n\nUnsaved connection changes will be discarded. Turn this integration off?`)) return;
    if (provider === 'xero') setDraftEnabled(enabled);
    setSaving(true); setError(''); setMessage('');
    try {
      if (provider === 'xero') {
        await saveXeroEnabled(enabled);
        setXeroSaved(enabled);
      } else {
        const response = await fetch('/api/ims/integrations', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, enabled, expectedBusinessId: businessId }),
        });
        const body: AvailabilityResponse = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Integration availability could not be saved.');
        if (body.businessId !== businessId) throw new Error('The active business changed. Reopen Settings before saving.');
        setData(body);
      }
      setDraftEnabled(null);
      setMessage(enabled ? 'Integration enabled. You can now configure its connection.' : 'Integration turned off. Saved configuration has been retained.');
    } catch (error) {
      if (provider === 'xero') setDraftEnabled(null);
      setError(error instanceof Error ? error.message : 'Integration availability could not be saved.');
    } finally { setSaving(false); }
  };

  if (!data) return <div>{error ? <><p role="alert">{error}</p><button type="button" onClick={() => setVersion(value => value + 1)}>Retry loading</button></> : <p role="status">Loading integration availability...</p>}</div>;
  if (!provider) return <div>
    <p>Enable only the services this business uses. Enablement, connection verification and sync policy are separate steps. Saved credentials alone do not prove a connection is ready.</p>
    <div className={styles.cards}>
      {[{ id: 'xero', label: 'Xero', purpose: 'Accounting documents, payments and reconciliation.', section: 'xero' as const, enabled: xeroEnabled, configured: false }, ...PROVIDERS.map(item => ({ ...item, ...data.integrations[item.id] }))].map(item =>
        <section key={item.id} className={styles.card} aria-label={item.label}>
          <div className={styles.cardHeading}><h2>{item.label}</h2><span className={styles.state} data-enabled={item.enabled}>{item.enabled ? 'Enabled' : 'Off'}</span></div>
          <p>{item.purpose}</p>
          <p>{item.enabled ? item.configured ? 'Configuration saved; review connection readiness.' : 'Open setup to review the connection.' : item.configured ? 'Saved configuration retained. Dependent activity is paused.' : 'Enable this integration before entering credentials.'}</p>
          <button type="button" onClick={() => onNavigate(item.section)}>{item.enabled ? 'Configure' : 'Review & enable'}</button>
        </section>)}
    </div>
    <section className={styles.card}><h2>Online sales channels</h2><p>Shopify and other online stores have separate instance credentials and activation policies. Native-store setup remains in its own workspace.</p><button type="button" onClick={() => onNavigate('shopify')}>Online store configuration</button></section>
  </div>;

  return <div>
    <section className={styles.card}>
      <div className={styles.cardHeading}>
        <div><h2>{descriptor?.label ?? 'Xero'}</h2><p>{descriptor?.purpose ?? 'Accounting connection, posting and reconciliation.'}</p></div>
        <label className={styles.toggle}>Use this integration
          <input type="checkbox" role="switch" checked={draftEnabled ?? availability?.enabled ?? false} disabled={!data.canManage || saving}
            onChange={event => {
              if (provider === 'xero') void save(event.target.checked);
              else { setDraftEnabled(event.target.checked); setMessage(''); }
            }} />
        </label>
      </div>
      <p>{availability?.enabled ? 'Enabled. Review connection readiness and optional sync policy below.' : 'Off. Dependent activity is paused. Credentials and history are retained; disconnecting is a separate action.'}</p>
      {!data.canManage && <p>Only administrators can change integration availability.</p>}
      {provider === 'xero' && saving && <p role="status">Saving Xero availability...</p>}
      {provider !== 'xero' && dirty && <div className={styles.actions}>
        <button type="button" data-primary onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save availability'}</button>
        <button type="button" disabled={saving} onClick={() => { setDraftEnabled(null); setError(''); }}>Cancel</button>
      </div>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {availability?.enabled && <fieldset disabled={dirty || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      onClickCapture={event => {
        if (dirty || saving) { event.preventDefault(); event.stopPropagation(); }
      }}
      onKeyDownCapture={event => {
        if ((dirty || saving) && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); }
      }}>
      {children ?? <ConnectionsTab key={`${businessId}-${provider}`} business={{ name: businessName, userId: '', databaseId: businessId }} provider={provider} onHelp={onHelp} />}
    </fieldset>}
    {provider === 'xero' && availability?.enabled && <section className={styles.card}><h2>Accounting configuration</h2><p>Mappings, document policies and sync history remain in Finances. Advisor permissions have their own settings page.</p><a href="#xero?tab=overview">Open Xero Integration</a><p><button type="button" onClick={() => onNavigate('advisor-access')}>Advisor permissions</button></p></section>}
  </div>;
}
