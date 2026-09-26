'use client';

import { ArrowLeft, CheckCircle2, ExternalLink, RefreshCw, Save, TestTube2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  ShopifyGiftCardsTab,
  ShopifyInstanceScope,
  ShopifyLogTab,
  ShopifyOrdersTab,
  ShopifyProductsTab,
} from '../../components/ShopifyView';
import ChannelProductRulesDialog from './ChannelProductRulesDialog';

export interface ShopifyChannelInstance {
  channelInstanceId: string;
  provider: 'shopify';
  providerDisplayName: string;
  displayName: string;
  externalAccountKey: string | null;
  enabled: boolean;
  runtimeStatus: 'draft' | 'active' | 'paused' | 'error';
  readinessStatus: 'not_tested' | 'ready' | 'error';
  lastSyncAt: string | null;
  safeError: string | null;
  settings: Record<string, unknown>;
}

type Tab = 'connection' | 'products' | 'operations' | 'customers' | 'accounting' | 'activity';
type AuthMode = 'client_credentials' | 'legacy_token';
type AccountingSettings = {
  dailyAutoSyncEnabled: boolean;
  payoutPostingEnabled: boolean;
  payoutAutoPostEnabled: boolean;
};

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 38, padding: '7px 10px', border: '1px solid var(--sv-border)',
  borderRadius: 4, background: '#fff', color: 'var(--sv-text-strong)', fontSize: 13,
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ShopifyChannelDetailView({ instance, canManage, xeroAccountingEnabled, onBack, onChanged }: {
  instance: ShopifyChannelInstance;
  canManage: boolean;
  xeroAccountingEnabled: boolean;
  onBack: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>('connection');
  const [displayName, setDisplayName] = useState(instance.displayName);
  const [shopDomain, setShopDomain] = useState(instance.externalAccountKey ?? '');
  const [authMode, setAuthMode] = useState<AuthMode>('client_credentials');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'manual' | 'add_matches'>(
    instance.settings?.productAssignmentMode === 'add_matches' ? 'add_matches' : 'manual',
  );
  const [publicationEnabled, setPublicationEnabled] = useState(
    instance.settings?.productPublicationEnabled === true || instance.settings?.productPublicationEnabled === 1,
  );
  const [accounting, setAccounting] = useState<AccountingSettings>({
    dailyAutoSyncEnabled: false,
    payoutPostingEnabled: false,
    payoutAutoPostEnabled: false,
  });

  const id = encodeURIComponent(instance.channelInstanceId);
  const scopedInstance = { channelInstanceId: instance.channelInstanceId, displayName: instance.displayName };

  useEffect(() => {
    setError('');
    Promise.all([
      fetch(`/api/ims/channels/${id}/shopify`).then(response => response.json()),
      fetch(`/api/ims/channels/${id}/shopify/settings`).then(response => response.json()),
    ]).then(([configurationBody, settingsBody]) => {
      if (!configurationBody.success) throw new Error(configurationBody.error || 'Connection settings could not be loaded.');
      setDisplayName(configurationBody.configuration.displayName);
      setShopDomain(configurationBody.configuration.shopDomain);
      setAuthMode(configurationBody.configuration.authMode);
      setClientId(configurationBody.configuration.clientId ?? '');
      setSecretConfigured(Boolean(configurationBody.configuration.secretConfigured));
      if (settingsBody.success) {
        setAccounting({
          dailyAutoSyncEnabled: Boolean(settingsBody.settings?.xero?.dailyAutoSyncEnabled),
          payoutPostingEnabled: Boolean(settingsBody.settings?.xero?.payoutPostingEnabled),
          payoutAutoPostEnabled: Boolean(settingsBody.settings?.xero?.payoutAutoPostEnabled),
        });
      }
    }).catch(loadError => setError(message(loadError, 'Shopify storefront configuration could not be loaded.')));
  }, [id]);

  async function run(label: string, operation: () => Promise<string>) {
    setBusy(label); setError(''); setNotice('');
    try { setNotice(await operation()); } catch (operationError) { setError(message(operationError, 'The operation failed.')); }
    finally { setBusy(''); }
  }

  async function responseBody(response: Response) {
    const body = await response.json();
    if (!response.ok || body.success === false) throw new Error(body.error || 'The operation failed.');
    return body;
  }

  async function saveConnection() {
    await run('connection', async () => {
      const response = await fetch(`/api/ims/channels/${id}/shopify`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName, shopDomain, authMode, clientId,
          clientSecret: authMode === 'client_credentials' ? secret : '',
          accessToken: authMode === 'legacy_token' ? secret : '',
        }),
      });
      await responseBody(response);
      setSecret(''); setSecretConfigured(true); await onChanged();
      return 'Connection settings saved. Test the connection before activating the store.';
    });
  }

  async function testConnection() {
    await run('test', async () => {
      await responseBody(await fetch(`/api/ims/channels/${id}/test`, { method: 'POST' }));
      await onChanged();
      return 'Connection test passed.';
    });
  }

  async function changeActivation() {
    const active = !instance.enabled;
    if (!window.confirm(`${active ? 'Activate' : 'Deactivate'} ${instance.displayName}?`)) return;
    await run('activation', async () => {
      await responseBody(await fetch(`/api/ims/channels/${id}/shopify/activation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
      }));
      await onChanged();
      return `${instance.displayName} was ${active ? 'activated' : 'deactivated'}.`;
    });
  }

  async function changeAssignmentMode(enabled: boolean) {
    if (enabled && !window.confirm('Enable automatic assignment? New matching products will be included, but existing inclusions will never be removed automatically.')) return;
    const mode = enabled ? 'add_matches' : 'manual';
    await run('assignment', async () => {
      await responseBody(await fetch(`/api/ims/channels/${id}/product-assignment`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      }));
      setAssignmentMode(mode); await onChanged();
      return `Product assignment is now ${enabled ? 'Automatic' : 'Manual'}.`;
    });
  }

  async function changePublication(enabled: boolean) {
    if (enabled && !window.confirm('Enable automatic publication for this storefront? Provider changes will follow its saved product assignments.')) return;
    await run('publication-setting', async () => {
      await responseBody(await fetch(`/api/ims/channels/${id}/product-publication`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      }));
      setPublicationEnabled(enabled); await onChanged();
      return `Automatic publication is ${enabled ? 'enabled' : 'disabled'}.`;
    });
  }

  async function reconcilePublication() {
    await run('publication', async () => {
      const status = await responseBody(await fetch(`/api/ims/channels/${id}/product-publication`));
      const pending = Number(status.needsPublication ?? 0);
      if (!pending) return 'This storefront already matches its product assignments.';
      if (!window.confirm(`Reconcile ${pending} product${pending === 1 ? '' : 's'} with ${instance.displayName}?`)) return 'Reconciliation cancelled.';
      const totals = { applied: 0, blocked: 0, failed: 0 };
      let enqueue = true;
      for (let batch = 0; batch < 100; batch++) {
        const body = await responseBody(await fetch(`/api/ims/channels/${id}/product-publication`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enqueue, limit: 100 }),
        }));
        totals.applied += Number(body.applied ?? 0); totals.blocked += Number(body.blocked ?? 0); totals.failed += Number(body.failed ?? 0);
        enqueue = false;
        if (Number(body.status?.pendingJobs ?? 0) === 0) break;
      }
      await onChanged();
      return `${totals.applied} applied, ${totals.blocked} blocked, ${totals.failed} failed.`;
    });
  }

  async function saveAccounting(next: AccountingSettings) {
    setAccounting(next);
    await run('accounting', async () => {
      const body = await responseBody(await fetch(`/api/ims/channels/${id}/shopify/settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { xero: next } }),
      }));
      setAccounting(body.settings.xero);
      return 'Store accounting options saved.';
    });
  }

  const tabButton = (value: Tab, label: string) => (
    <button type="button" onClick={() => setTab(value)} style={{ minHeight: 36, padding: '7px 11px', border: 0, borderBottom: tab === value ? '2px solid #147d92' : '2px solid transparent', background: 'transparent', color: tab === value ? '#0f6170' : 'var(--sv-text-dim)', fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>{label}</button>
  );

  return <ShopifyInstanceScope instance={scopedInstance}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={onBack} title="Back to Sales Channels" aria-label="Back to Sales Channels" style={{ width: 34, height: 34, border: '1px solid var(--sv-border)', background: '#fff', color: '#334155', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><ArrowLeft size={17} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: 'var(--sv-text-strong)' }}>{instance.displayName}</h1>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--sv-text-dim)', overflowWrap: 'anywhere' }}>{instance.externalAccountKey || 'Shopify connection'}</div>
        </div>
        <span style={{ padding: '5px 8px', background: instance.enabled ? '#dcfce7' : '#fef3c7', color: instance.enabled ? '#166534' : '#92400e', fontSize: 11, fontWeight: 750 }}>{instance.enabled ? 'Active' : 'Paused'}</span>
      </div>

      {(error || notice) && <div role="status" style={{ marginBottom: 12, padding: '9px 12px', border: `1px solid ${error ? '#fecaca' : '#bbf7d0'}`, background: error ? '#fef2f2' : '#f0fdf4', color: error ? '#991b1b' : '#166534', fontSize: 12 }}>{error || notice}</div>}

      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', borderBottom: '1px solid var(--sv-border)', marginBottom: 18 }}>
        {tabButton('connection', 'Connection')}{tabButton('products', 'Products')}{tabButton('operations', 'Orders & Inventory')}{tabButton('customers', 'Customers & Gift Cards')}{tabButton('accounting', 'Accounting')}{tabButton('activity', 'Activity')}
      </div>

      {tab === 'connection' && <section style={{ maxWidth: 760 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Store name<input value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={!canManage} style={{ ...inputStyle, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Shop domain<input value={shopDomain} onChange={event => setShopDomain(event.target.value)} disabled={!canManage} placeholder="example.myshopify.com" style={{ ...inputStyle, marginTop: 5 }} /></label>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Authentication method<select value={authMode} onChange={event => setAuthMode(event.target.value as AuthMode)} disabled={!canManage} style={{ ...inputStyle, marginTop: 5 }}><option value="client_credentials">Client credentials</option><option value="legacy_token">Legacy access token</option></select></label>
          {authMode === 'client_credentials' && <label style={{ fontSize: 12, fontWeight: 700 }}>Client ID<input value={clientId} onChange={event => setClientId(event.target.value)} disabled={!canManage} style={{ ...inputStyle, marginTop: 5 }} /></label>}
          <label style={{ fontSize: 12, fontWeight: 700 }}>{authMode === 'client_credentials' ? 'Client secret' : 'Access token'}<input type="password" value={secret} onChange={event => setSecret(event.target.value)} disabled={!canManage} placeholder={secretConfigured ? 'Leave blank to keep current secret' : 'Required'} autoComplete="new-password" style={{ ...inputStyle, marginTop: 5 }} /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void saveConnection()} style={{ minHeight: 36, padding: '7px 12px', border: 0, background: '#147d92', color: '#fff', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700, cursor: 'pointer' }}><Save size={15} /> Save</button>
            <button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void testConnection()} style={{ minHeight: 36, padding: '7px 12px', border: '1px solid var(--sv-border)', background: '#fff', color: '#0369a1', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700, cursor: 'pointer' }}><TestTube2 size={15} /> Test connection</button>
            <button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void changeActivation()} style={{ minHeight: 36, padding: '7px 12px', border: '1px solid var(--sv-border)', background: '#fff', color: instance.enabled ? '#991b1b' : '#166534', fontWeight: 700, cursor: 'pointer' }}>{instance.enabled ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>
      </section>}

      {tab === 'products' && <section>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, padding: 12, border: '1px solid var(--sv-border)', background: '#f8fafc' }}>
          <button type="button" disabled={!canManage} onClick={() => setRulesOpen(true)} style={{ minHeight: 34, padding: '6px 10px', border: '1px solid var(--sv-border)', background: '#fff', fontWeight: 700, cursor: 'pointer' }}>Product rules</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={assignmentMode === 'add_matches'} disabled={!canManage || Boolean(busy)} onChange={event => void changeAssignmentMode(event.target.checked)} /> Automatic assignment</label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={publicationEnabled} disabled={!canManage || Boolean(busy)} onChange={event => void changePublication(event.target.checked)} /> Automatic publication</label>
          <button type="button" disabled={!canManage || !publicationEnabled || Boolean(busy)} onClick={() => void reconcilePublication()} style={{ minHeight: 34, padding: '6px 10px', border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700, cursor: 'pointer' }}><RefreshCw size={14} /> Reconcile products</button>
          <a href="#products" style={{ marginLeft: 'auto', color: '#0369a1', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700 }}>Open All Products <ExternalLink size={13} /></a>
        </div>
        <ShopifyProductsTab />
      </section>}
      {tab === 'operations' && <ShopifyOrdersTab xeroAccountingEnabled={xeroAccountingEnabled} />}
      {tab === 'customers' && <ShopifyGiftCardsTab />}
      {tab === 'accounting' && <section style={{ maxWidth: 760 }}>
        <div style={{ padding: 16, border: '1px solid var(--sv-border)', background: '#f8fafc', marginBottom: 14, fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
          These storefront options are additional opt-ins. Business-wide document and posting policy remains authoritative in <a href="#xero" style={{ color: '#0369a1', fontWeight: 700 }}>Xero Settings</a>.
        </div>
        {!xeroAccountingEnabled && <div style={{ marginBottom: 14, color: '#92400e', fontSize: 12 }}>Xero accounting is disabled for this business, so these options cannot run.</div>}
        {([
          ['dailyAutoSyncEnabled', 'Daily online-sales batch sync'],
          ['payoutPostingEnabled', 'Allow Shopify payout posting'],
          ['payoutAutoPostEnabled', 'Automatically post balanced payouts'],
        ] as const).map(([key, label]) => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 40, borderBottom: '1px solid var(--sv-border)', fontSize: 13 }}><input type="checkbox" checked={accounting[key]} disabled={!canManage || !xeroAccountingEnabled || Boolean(busy) || (key === 'payoutAutoPostEnabled' && !accounting.payoutPostingEnabled)} onChange={event => void saveAccounting({ ...accounting, [key]: event.target.checked, ...(key === 'payoutPostingEnabled' && !event.target.checked ? { payoutAutoPostEnabled: false } : {}) })} /> {label}</label>)}
      </section>}
      {tab === 'activity' && <ShopifyLogTab />}

      {rulesOpen && <ChannelProductRulesDialog instance={instance} onClose={() => setRulesOpen(false)} />}
    </div>
  </ShopifyInstanceScope>;
}