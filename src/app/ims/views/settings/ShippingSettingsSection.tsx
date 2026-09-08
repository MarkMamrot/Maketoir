'use client';

import { Package, Pencil, Plus, Save, TestTube2, Truck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AUSPOST_PACKAGING_CATALOGUE } from '@/lib/ims/shipping/ausPostPackagingCatalogue';

type Account = {
  id: number; provider: string; displayName: string;
  accountNumber: string | null; dispatchLocationId: number | null; dispatchLocationName: string | null;
  credentialsConfigured: boolean; apiKeyLength: number; passwordLength: number;
  verifiedAt: string | null; verificationError: string | null; isActive: boolean;
};

type Preset = {
  id: number; name: string; packageType: string; lengthMm: number; widthMm: number; heightMm: number;
  tareWeightKg: number; maxWeightKg: number | null; allowRotation: boolean; sortPriority: number; isActive: boolean;
};

const blankAccount = { provider: 'auspost_eparcel', displayName: '', accountNumber: '', apiKey: '', password: '', dispatchLocationId: '', isActive: true };
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
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [selectedCatalogueIds, setSelectedCatalogueIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (preferredAccountId?: number) => {
    const [settingsResponse, locationsResponse] = await Promise.all([
      fetch('/api/ims/shipping/settings'),
      fetch('/api/ims/locations'),
    ]);
    const settingsResult = await settingsResponse.json();
    const locationsResult = await locationsResponse.json();
    if (!settingsResponse.ok || !settingsResult.success) throw new Error(settingsResult.error || 'Unable to load shipping settings.');
    const loadedAccounts: Account[] = settingsResult.data.accounts ?? [];
    setAccounts(loadedAccounts);
    setPresets(settingsResult.data.presets ?? []);
    setLocations(locationsResult.success ? locationsResult.data ?? [] : []);
    setAccount((current: any) => {
      const selected = loadedAccounts.find(item => item.id === (preferredAccountId ?? current.id))
        ?? loadedAccounts[0];
      return selected ? { ...selected, apiKey: '', password: '', dispatchLocationId: selected.dispatchLocationId ?? '' } : current;
    });
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
      await load(resource === 'account' ? Number(result.id) : undefined);
      if (resource === 'preset') setPreset(blankPreset);
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

  const importCataloguePresets = async () => {
    setBusy('import-catalogue'); setMessage('');
    try {
      const response = await fetch('/api/ims/shipping/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'auspost_catalogue', catalogueIds: [...selectedCatalogueIds] }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to add Australia Post presets.');
      await load();
      setSelectedCatalogueIds(new Set());
      setCatalogueOpen(false);
      setMessage(`${result.created} Australia Post preset${result.created === 1 ? '' : 's'} added${result.skipped ? `; ${result.skipped} already existed` : ''}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to add Australia Post presets.'); }
    finally { setBusy(''); }
  };

  return (
    <div style={{ padding: 32, maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Truck size={20} color="var(--sv-action)" /><h2 style={{ margin: 0, fontSize: 18 }}>Shipping</h2></div>
      <p style={{ margin: '0 0 24px', color: 'var(--sv-text-dim)', fontSize: 13 }}>Connect carrier accounts and define the packages used when shipping Sales Orders.</p>
      {message && <div role="status" style={{ marginBottom: 16, padding: '9px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 12 }}>{message}</div>}

      <section style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 18, marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}><h3 style={{ margin: 0, fontSize: 15 }}>Carrier accounts</h3><button type="button" onClick={() => setAccount(blankAccount)} style={secondaryButtonStyle}><Plus size={14} />New account</button></div>
        {accounts.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--sv-etch)' }}>
          <div><strong style={{ fontSize: 13 }}>{item.displayName}</strong><div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{item.provider === 'auspost_eparcel' ? 'Australia Post eParcel' : 'MyPost Business'} · {item.accountNumber || 'No account number'}</div></div>
          <ConnectionStatus account={item} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button title="Edit carrier account" onClick={() => setAccount({ ...item, apiKey: '', password: '', dispatchLocationId: item.dispatchLocationId ?? '' })} style={secondaryButtonStyle}><Pencil size={14} />Edit</button>
            {item.provider === 'auspost_eparcel' && <button title="Test connection" disabled={busy === `test-${item.id}`} onClick={() => testAccount(item.id)} style={secondaryButtonStyle}><TestTube2 size={14} />{busy === `test-${item.id}` ? 'Testing...' : 'Test connection'}</button>}
            {item.isActive && <button title="Deactivate carrier account" disabled={busy === `delete-account-${item.id}`} onClick={() => deactivate('account', item.id)} style={iconButtonStyle}><X size={15} /></button>}
          </div>
        </div>)}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 14, marginTop: 18 }}>
          <Field label="Carrier"><select value={account.provider} onChange={event => setAccount({ ...account, provider: event.target.value, isActive: event.target.value !== 'mypost_business' })} style={inputStyle}><option value="auspost_eparcel">Australia Post eParcel</option><option value="mypost_business">MyPost Business</option></select></Field>
          <Field label="Account name"><input value={account.displayName} onChange={event => setAccount({ ...account, displayName: event.target.value })} style={inputStyle} /></Field>
          <Field label="Account number"><input inputMode="numeric" value={account.accountNumber ?? ''} onChange={event => setAccount({ ...account, accountNumber: event.target.value })} style={inputStyle} /></Field>
          <Field label="Dispatch location"><select value={account.dispatchLocationId ?? ''} onChange={event => setAccount({ ...account, dispatchLocationId: event.target.value ? Number(event.target.value) : null })} style={inputStyle}><option value="">Any location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
          <Field label="API key"><input type="password" autoComplete="new-password" value={account.apiKey ?? ''} placeholder={maskedCredential(account.apiKeyLength)} aria-label="API key" onChange={event => setAccount({ ...account, apiKey: event.target.value })} style={inputStyle} /></Field>
          <Field label="API password"><input type="password" autoComplete="new-password" value={account.password ?? ''} placeholder={maskedCredential(account.passwordLength)} aria-label="API password" onChange={event => setAccount({ ...account, password: event.target.value })} style={inputStyle} /></Field>
        </div>
        {account.provider === 'mypost_business' && <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>MyPost Business requires approved ecommerce-partner API access and cannot be enabled yet.</p>}
        <button onClick={() => save('account', { ...account, isActive: account.provider !== 'mypost_business' })} disabled={Boolean(busy)} style={actionButtonStyle}><Save size={15} />{account.id ? 'Update account' : 'Add account'}</button>
      </section>

      <section style={{ borderTop: '1px solid var(--sv-etch)', paddingTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Package size={17} /><h3 style={{ margin: 0, fontSize: 15 }}>Package presets</h3></div><button type="button" onClick={() => setCatalogueOpen(true)} style={secondaryButtonStyle}><Plus size={14} />Australia Post presets</button></div>
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
      {catalogueOpen && <AusPostCatalogueDialog existingNames={new Set(presets.map(item => item.name.toLowerCase()))} selectedIds={selectedCatalogueIds} onSelectedIdsChange={setSelectedCatalogueIds} busy={busy === 'import-catalogue'} onAdd={importCataloguePresets} onClose={() => setCatalogueOpen(false)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span style={labelStyle}>{label}</span>{children}</label>;
}

function ConnectionStatus({ account }: { account: Account }) {
  const failed = Boolean(account.verificationError);
  const connected = Boolean(account.verifiedAt) && !failed;
  const label = failed ? 'Connection failed' : connected ? 'Connected' : 'Not tested';
  const color = failed ? 'var(--sv-red)' : connected ? 'var(--sv-mint)' : 'var(--sv-text-dim)';
  return <div title={account.verificationError || undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color, fontSize: 12, fontWeight: 700 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{label}</div>;
}

function maskedCredential(length: number | undefined): string {
  return length ? '•'.repeat(length) : '';
}

const iconButtonStyle: React.CSSProperties = { width: 32, height: 32, display: 'inline-grid', placeItems: 'center', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' };
const actionButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 16, padding: '8px 13px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const secondaryButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontWeight: 700, cursor: 'pointer' };

function AusPostCatalogueDialog({ existingNames, selectedIds, onSelectedIdsChange, busy, onAdd, onClose }: { existingNames: Set<string>; selectedIds: Set<string>; onSelectedIdsChange: (ids: Set<string>) => void; busy: boolean; onAdd: () => void; onClose: () => void }) {
  const categories = [...new Set(AUSPOST_PACKAGING_CATALOGUE.map(item => item.category))];
  const available = AUSPOST_PACKAGING_CATALOGUE.filter(item => !existingNames.has(item.name.toLowerCase()));
  const toggle = (id: string, checked: boolean) => onSelectedIdsChange(new Set(checked ? [...selectedIds, id] : [...selectedIds].filter(value => value !== id)));
  return <div role="dialog" aria-modal="true" aria-label="Australia Post package presets" style={{ position: 'fixed', inset: 0, zIndex: 1400, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(15,23,42,.58)' }}>
    <div style={{ width: 'min(820px,100%)', maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column', border: '1px solid var(--sv-etch)', borderRadius: 8, background: 'var(--sv-bg-1)', boxShadow: '0 22px 60px rgba(0,0,0,.28)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--sv-etch)' }}><div><h3 style={{ margin: 0, fontSize: 16 }}>Australia Post presets</h3><p style={{ margin: '4px 0 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Reference dimensions are converted from centimetres to millimetres. Review physical packaging before use.</p></div><button type="button" title="Close" onClick={onClose} style={iconButtonStyle}><X size={16} /></button></header>
      <div style={{ overflowY: 'auto', padding: '4px 18px 14px' }}>{categories.map(category => <section key={category} style={{ paddingTop: 14 }}><h4 style={{ margin: '0 0 7px', fontSize: 12, color: 'var(--sv-text-dim)' }}>{category}</h4>{AUSPOST_PACKAGING_CATALOGUE.filter(item => item.category === category).map(item => { const exists = existingNames.has(item.name.toLowerCase()); return <label key={item.catalogueId} style={{ display: 'grid', gridTemplateColumns: '24px minmax(180px,1fr) minmax(160px,.7fr) 90px', gap: 8, alignItems: 'center', minHeight: 34, borderBottom: '1px solid var(--sv-etch)', fontSize: 12, opacity: exists ? .5 : 1 }}><input type="checkbox" disabled={exists} checked={!exists && selectedIds.has(item.catalogueId)} onChange={event => toggle(item.catalogueId, event.target.checked)} /><span>{item.name}{exists ? ' · Added' : ''}</span><span style={{ color: 'var(--sv-text-dim)' }}>{item.lengthMm} × {item.widthMm} × {item.heightMm} mm</span><span style={{ color: 'var(--sv-text-dim)' }}>{item.maxWeightKg} kg max</span></label>; })}</section>)}</div>
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--sv-etch)' }}><button type="button" disabled={!available.length} onClick={() => onSelectedIdsChange(new Set(available.map(item => item.catalogueId)))} style={secondaryButtonStyle}>Select available</button><div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button><button type="button" disabled={!selectedIds.size || busy} onClick={onAdd} style={{ ...actionButtonStyle, marginTop: 0, opacity: selectedIds.size && !busy ? 1 : .55 }}>{busy ? 'Adding...' : `Add selected (${selectedIds.size})`}</button></div></footer>
    </div>
  </div>;
}
