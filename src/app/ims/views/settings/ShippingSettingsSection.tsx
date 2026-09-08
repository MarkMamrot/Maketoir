'use client';

import { Package, Plus, Save, TestTube2, Truck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type Account = {
  id: number; provider: string; displayName: string; environment: string; baseUrl: string | null;
  accountNumber: string | null; dispatchLocationId: number | null; dispatchLocationName: string | null;
  credentialsConfigured: boolean; verifiedAt: string | null; verificationError: string | null; isActive: boolean;
};

type Preset = {
  id: number; name: string; packageType: string; lengthMm: number; widthMm: number; heightMm: number;
  tareWeightKg: number; maxWeightKg: number | null; allowRotation: boolean; sortPriority: number; isActive: boolean;
};

const blankAccount = { provider: 'auspost_eparcel', displayName: '', environment: 'test', baseUrl: '', accountNumber: '', apiKey: '', password: '', dispatchLocationId: '', isActive: true };
const blankPreset = { name: '', packageType: 'box', lengthMm: '', widthMm: '', heightMm: '', tareWeightKg: '0', maxWeightKg: '', allowRotation: true, sortPriority: '0', isActive: true };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)' };

export function ShippingSettingsSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [locations, setLocations] = useState<Array<{ id: number; name: string }>>([]);
  const [account, setAccount] = useState<any>(blankAccount);
  const [preset, setPreset] = useState<any>(blankPreset);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [settingsResponse, locationsResponse] = await Promise.all([
      fetch('/api/ims/shipping/settings'),
      fetch('/api/ims/locations'),
    ]);
    const settingsResult = await settingsResponse.json();
    const locationsResult = await locationsResponse.json();
    if (!settingsResponse.ok || !settingsResult.success) throw new Error(settingsResult.error || 'Unable to load shipping settings.');
    setAccounts(settingsResult.data.accounts ?? []);
    setPresets(settingsResult.data.presets ?? []);
    setLocations(locationsResult.success ? locationsResult.data ?? [] : []);
  }, []);

  useEffect(() => { load().catch(error => setMessage(error.message)); }, [load]);

  const save = async (resource: 'account' | 'preset', data: any) => {
    setBusy(`save-${resource}`); setMessage('');
    try {
      const response = await fetch('/api/ims/shipping/settings', {
        method: data.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource, data }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save shipping settings.');
      await load();
      if (resource === 'account') setAccount(blankAccount); else setPreset(blankPreset);
      setMessage(resource === 'account' ? 'Carrier account saved.' : 'Package preset saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save shipping settings.'); }
    finally { setBusy(''); }
  };

  const deactivate = async (resource: 'account' | 'preset', id: number) => {
    setBusy(`delete-${resource}-${id}`); setMessage('');
    try {
      const response = await fetch('/api/ims/shipping/settings', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource, id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to deactivate this record.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to deactivate this record.'); }
    finally { setBusy(''); }
  };

  const testAccount = async (id: number) => {
    setBusy(`test-${id}`); setMessage('');
    try {
      const response = await fetch('/api/ims/shipping/settings/accounts/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Connection test failed.');
      await load();
      setMessage(`Connection verified. ${Number(result.data?.productCount ?? 0)} contract services available.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection test failed.'); }
    finally { setBusy(''); }
  };

  return (
    <div style={{ padding: 32, maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Truck size={20} color="var(--sv-action)" /><h2 style={{ margin: 0, fontSize: 18 }}>Shipping</h2></div>
      <p style={{ margin: '0 0 24px', color: 'var(--sv-text-dim)', fontSize: 13 }}>Connect carrier accounts and define the packages used when shipping Sales Orders.</p>
      {message && <div role="status" style={{ marginBottom: 16, padding: '9px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 12 }}>{message}</div>}

      <section style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 18, marginBottom: 30 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>Carrier accounts</h3>
        {accounts.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(150px,.8fr) auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--sv-etch)' }}>
          <div><strong style={{ fontSize: 13 }}>{item.displayName}</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{item.provider === 'auspost_eparcel' ? 'Australia Post eParcel' : 'MyPost Business'} · {item.environment} · {item.accountNumber || 'No account number'}</div></div>
          <div style={{ fontSize: 12, color: item.verificationError ? 'var(--sv-red)' : 'var(--sv-text-dim)' }}>{item.verificationError || (item.verifiedAt ? 'Connection verified' : 'Not verified')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button title="Edit carrier account" onClick={() => setAccount({ ...item, apiKey: '', password: '', dispatchLocationId: item.dispatchLocationId ?? '' })} style={iconButtonStyle}><Save size={15} /></button>
            {item.provider === 'auspost_eparcel' && <button title="Test connection" disabled={busy === `test-${item.id}`} onClick={() => testAccount(item.id)} style={iconButtonStyle}><TestTube2 size={15} /></button>}
            {item.isActive && <button title="Deactivate carrier account" disabled={busy === `delete-account-${item.id}`} onClick={() => deactivate('account', item.id)} style={iconButtonStyle}><X size={15} /></button>}
          </div>
        </div>)}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginTop: 16 }}>
          <Field label="Carrier"><select value={account.provider} onChange={event => setAccount({ ...account, provider: event.target.value, isActive: event.target.value !== 'mypost_business' })} style={inputStyle}><option value="auspost_eparcel">Australia Post eParcel</option><option value="mypost_business">MyPost Business</option></select></Field>
          <Field label="Account name"><input value={account.displayName} onChange={event => setAccount({ ...account, displayName: event.target.value })} style={inputStyle} /></Field>
          <Field label="Environment"><select value={account.environment} onChange={event => setAccount({ ...account, environment: event.target.value })} style={inputStyle}><option value="test">Testbed</option><option value="production">Production</option></select></Field>
          <Field label="Account number"><input inputMode="numeric" value={account.accountNumber ?? ''} onChange={event => setAccount({ ...account, accountNumber: event.target.value })} style={inputStyle} /></Field>
          <Field label="Dispatch location"><select value={account.dispatchLocationId ?? ''} onChange={event => setAccount({ ...account, dispatchLocationId: event.target.value ? Number(event.target.value) : null })} style={inputStyle}><option value="">Any location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field label="API key"><input type="password" autoComplete="new-password" value={account.apiKey ?? ''} placeholder={account.credentialsConfigured ? 'Saved; leave blank to keep' : ''} onChange={event => setAccount({ ...account, apiKey: event.target.value })} style={inputStyle} /></Field>
          <Field label="API password"><input type="password" autoComplete="new-password" value={account.password ?? ''} placeholder={account.credentialsConfigured ? 'Saved; leave blank to keep' : ''} onChange={event => setAccount({ ...account, password: event.target.value })} style={inputStyle} /></Field>
          {account.environment === 'test' && <Field label="Testbed API URL"><input type="url" value={account.baseUrl ?? ''} onChange={event => setAccount({ ...account, baseUrl: event.target.value })} style={inputStyle} /></Field>}
        </div>
        {account.provider === 'mypost_business' && <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>MyPost Business requires approved ecommerce-partner API access and cannot be enabled yet.</p>}
        <button onClick={() => save('account', { ...account, isActive: account.provider !== 'mypost_business' })} disabled={Boolean(busy)} style={actionButtonStyle}><Save size={15} />{account.id ? 'Update account' : 'Add account'}</button>
      </section>

      <section style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><Package size={17} /><h3 style={{ margin: 0, fontSize: 15 }}>Package presets</h3></div>
        {presets.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 1fr auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--sv-etch)' }}>
          <div><strong style={{ fontSize: 13 }}>{item.name}</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{item.packageType}</div></div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{item.lengthMm} × {item.widthMm} × {item.heightMm} mm · {item.tareWeightKg} kg tare</div>
          <div style={{ display: 'flex', gap: 6 }}><button title="Edit package preset" onClick={() => setPreset({ ...item, maxWeightKg: item.maxWeightKg ?? '' })} style={iconButtonStyle}><Save size={15} /></button>{item.isActive && <button title="Deactivate package preset" onClick={() => deactivate('preset', item.id)} style={iconButtonStyle}><X size={15} /></button>}</div>
        </div>)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 16 }}>
          <Field label="Name"><input value={preset.name} onChange={event => setPreset({ ...preset, name: event.target.value })} style={inputStyle} /></Field>
          <Field label="Type"><select value={preset.packageType} onChange={event => setPreset({ ...preset, packageType: event.target.value })} style={inputStyle}>{['box','satchel','pallet','custom'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></Field>
          {[['Length mm','lengthMm'],['Width mm','widthMm'],['Height mm','heightMm'],['Tare kg','tareWeightKg'],['Max kg','maxWeightKg']].map(([label, key]) => <Field key={key} label={label}><input type="number" min="0" step="0.01" value={preset[key]} onChange={event => setPreset({ ...preset, [key]: event.target.value })} style={inputStyle} /></Field>)}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 12 }}><input type="checkbox" checked={preset.allowRotation} onChange={event => setPreset({ ...preset, allowRotation: event.target.checked })} /> Products may be rotated to fit</label>
        <button onClick={() => save('preset', { ...preset, lengthMm: Number(preset.lengthMm), widthMm: Number(preset.widthMm), heightMm: Number(preset.heightMm), tareWeightKg: Number(preset.tareWeightKg), maxWeightKg: preset.maxWeightKg === '' ? null : Number(preset.maxWeightKg), sortPriority: Number(preset.sortPriority) })} disabled={Boolean(busy)} style={actionButtonStyle}><Plus size={15} />{preset.id ? 'Update preset' : 'Add preset'}</button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span style={labelStyle}>{label}</span>{children}</label>;
}

const iconButtonStyle: React.CSSProperties = { width: 32, height: 32, display: 'inline-grid', placeItems: 'center', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' };
const actionButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 16, padding: '8px 13px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700, cursor: 'pointer' };
