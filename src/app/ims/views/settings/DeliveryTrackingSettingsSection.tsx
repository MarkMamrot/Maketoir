'use client';

import { useEffect, useRef, useState } from 'react';
import { createDefaultSalesChannelRegistry } from '@/lib/channels/defaultRegistry';
import { useSettingsDirty } from './SettingsShell';
import {
  validateDeliveryTrackingSettingsReport, type DeliveryTrackingSettingsReport,
} from '@/lib/ims/shipping/deliveryTrackingSettings';

const channelTypes = createDefaultSalesChannelRegistry().list();
const buttonStyle = {
  padding: '8px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6,
  background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer',
};

export function DeliveryTrackingSettingsSection({ businessId, onHelp }: { businessId: string; onHelp?: () => void }) {
  const [settings, setSettings] = useState<DeliveryTrackingSettingsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  useSettingsDirty(dirty);
  const currentBusiness = useRef(businessId);
  currentBusiness.current = businessId;
  const loaded = settings?.businessId === businessId;

  useEffect(() => {
    const controller = new AbortController();
    setSettings(null); setLoading(true); setError(''); setSaved(false); setSaving(false); setDirty(false);
    async function load() {
      try {
        const response = await fetch('/api/ims/shipping/delivery-settings', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Delivery tracking settings could not be loaded. Reload saved settings or check Runtime Issues.');
        const result = validateDeliveryTrackingSettingsReport(await response.json());
        if (result.businessId !== businessId) throw new Error('The active business changed. Reopen Shipping Settings for the intended business.');
        if (!controller.signal.aborted) setSettings(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Delivery tracking settings could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [businessId, reload]);

  async function save() {
    if (!settings || !loaded || settings.readOnly || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/ims/shipping/delivery-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedBusinessId: businessId, channels: settings.channels }),
      });
      if (!response.ok) throw new Error(response.status === 409
        ? 'The active business changed. Reload saved settings before saving.'
        : 'Delivery tracking settings could not be saved. Reload saved settings or check Runtime Issues.');
      const result = validateDeliveryTrackingSettingsReport(await response.json());
      if (result.businessId !== businessId) throw new Error('Delivery tracking settings were returned for a different business.');
      if (currentBusiness.current === businessId) { setSettings(result); setSaved(true); setDirty(false); }
    } catch (error) {
      if (currentBusiness.current === businessId) setError(error instanceof Error ? error.message : 'Delivery tracking settings could not be saved.');
    } finally {
      if (currentBusiness.current === businessId) setSaving(false);
    }
  }

  return <section aria-labelledby="delivery-tracking-settings-title" style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 18, marginBottom: 30 }}>
    <h3 id="delivery-tracking-settings-title" style={{ margin: '0 0 10px', fontSize: 15 }}>Delivery information by online channel</h3>
    <p style={{ fontSize: 13 }}>Choose which online channel types to check for parcel delivery in this business. Each switch applies to all stores of that type. Defaults: Amazon On; Shopify and Solvantis Online Store Off.</p>
    <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Automatic checks support dispatched Australia Post eParcel parcels prepared in Solvantis. The platform-wide Online channel delivery tracking job must also be On; it starts Off until tracking access is verified. Pending parcels are checked after six hours; failed checks retry after one hour. Changing these switches does not start a carrier request.</p>
    {loading && <p role="status">Loading delivery tracking settings...</p>}
    {loaded && settings && <fieldset disabled={saving || settings.readOnly} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend style={{ fontSize: 12, marginBottom: 8 }}>Fetch delivery information for</legend>
      {channelTypes.map(channel => <label key={channel.provider} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
        <input type="checkbox" role="switch" aria-label={`${channel.displayName} delivery tracking`}
          aria-checked={settings.channels[channel.provider]} checked={settings.channels[channel.provider]}
          onChange={event => { setSettings({ ...settings, channels: { ...settings.channels, [channel.provider]: event.target.checked } }); setSaved(false); setDirty(true); }} />
        {channel.displayName}: {settings.channels[channel.provider] ? 'On' : 'Off'}
      </label>)}
    </fieldset>}
    <p style={{ fontSize: 12 }}>Turning a type Off stops future polls, not checks already in progress, and keeps recorded evidence. Amazon&apos;s 30-day PII review rules remain Amazon-only. These switches do not anonymize data or change stock, fulfilment, customer details or financial records.</p>
    {loaded && settings?.readOnly && <p>Advisor accounts can view these settings but cannot change them.</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" disabled={!loaded || settings?.readOnly || saving} onClick={() => void save()} style={buttonStyle}>{saving ? 'Saving...' : 'Save delivery tracking'}</button>
      <button type="button" disabled={loading || saving} onClick={() => setReload(value => value + 1)} style={buttonStyle}>Reload saved settings</button>
      {dirty && <button type="button" disabled={saving} onClick={() => setReload(value => value + 1)} style={buttonStyle}>Cancel delivery changes</button>}
      {onHelp && <button type="button" onClick={onHelp} style={buttonStyle}>Delivery tracking help</button>}
    </div>
    {saved && <p role="status">Delivery tracking settings saved.</p>}
    {error && <p role="alert" style={{ color: 'var(--sv-red)' }}>{error}</p>}
  </section>;
}
