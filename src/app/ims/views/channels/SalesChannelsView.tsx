'use client';

import { AlertCircle, Check, CheckCircle2, Clock3, Download, ListChecks, MapPin, Pencil, Plus, PauseCircle, RefreshCw, RotateCcw, ShoppingBag, Store, TestTube2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ChannelCapabilities {
  catalogue: boolean;
  inventory: boolean;
  orders: boolean;
  fulfilments: boolean;
  returns: boolean;
  customers: boolean;
  giftCards: boolean;
  loyalty: boolean;
  settlements: boolean;
}

interface ChannelInstance {
  channelInstanceId: string;
  provider: 'shopify' | 'native_shop' | 'amazon';
  providerDisplayName: string;
  displayName: string;
  externalAccountKey: string | null;
  enabled: boolean;
  runtimeStatus: 'draft' | 'active' | 'paused' | 'error';
  readinessStatus: 'not_tested' | 'ready' | 'error';
  lastSyncAt: string | null;
  safeError: string | null;
  settings: Record<string, unknown>;
  capabilities: ChannelCapabilities;
}

interface OrderLocation {
  id: number;
  name: string;
}

interface AmazonMapping {
  mappingId: number;
  variantId: string | null;
  asin: string | null;
  sellerSku: string;
  status: 'linked' | 'unmatched' | 'conflict' | 'archived';
  itemName: string | null;
  productName: string | null;
  imsSku: string | null;
  selected: boolean;
  inventoryEnabled: boolean;
}

const CAPABILITY_LABELS: Array<[keyof ChannelCapabilities, string]> = [
  ['catalogue', 'Catalogue'],
  ['inventory', 'Inventory'],
  ['orders', 'Orders'],
  ['fulfilments', 'Fulfilments'],
  ['returns', 'Returns'],
  ['customers', 'Customers'],
  ['giftCards', 'Gift cards'],
  ['loyalty', 'Loyalty'],
  ['settlements', 'Settlements'],
];

function statusDetails(instance: ChannelInstance) {
  if (instance.runtimeStatus === 'draft') {
    return { label: 'Setup pending', color: '#475569', background: '#e2e8f0', icon: Clock3 };
  }
  if (!instance.enabled || instance.runtimeStatus === 'paused') {
    return { label: 'Paused', color: '#92400e', background: '#fef3c7', icon: PauseCircle };
  }
  if (instance.runtimeStatus === 'error' || instance.readinessStatus === 'error') {
    return { label: 'Needs attention', color: '#b91c1c', background: '#fee2e2', icon: AlertCircle };
  }
  if (instance.runtimeStatus === 'active' && instance.readinessStatus === 'ready') {
    return { label: 'Active', color: '#166534', background: '#dcfce7', icon: CheckCircle2 };
  }
  return { label: 'Setup pending', color: '#475569', background: '#e2e8f0', icon: Clock3 };
}

function formatLastSync(value: string | null): string {
  if (!value) return 'Not yet synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sync time unavailable';
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function SalesChannelsView({ canManage = false }: { canManage?: boolean }) {
  const [instances, setInstances] = useState<ChannelInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [inventorySyncingId, setInventorySyncingId] = useState<string | null>(null);
  const [orderSyncingId, setOrderSyncingId] = useState<string | null>(null);
  const [returnSyncingId, setReturnSyncingId] = useState<string | null>(null);
  const [orderSettingsInstance, setOrderSettingsInstance] = useState<ChannelInstance | null>(null);
  const [orderLocations, setOrderLocations] = useState<OrderLocation[]>([]);
  const [orderLocationId, setOrderLocationId] = useState('');
  const [orderSettingsLoading, setOrderSettingsLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [amazonDialogOpen, setAmazonDialogOpen] = useState(false);
  const [amazonDisplayName, setAmazonDisplayName] = useState('Amazon Australia');
  const [mappingInstance, setMappingInstance] = useState<ChannelInstance | null>(null);
  const [mappings, setMappings] = useState<AmazonMapping[]>([]);
  const [mappingIds, setMappingIds] = useState<Set<number>>(new Set());
  const [mappingLoading, setMappingLoading] = useState(false);

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ims/channels', { signal });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Sales channels could not be loaded.');
      setInstances(Array.isArray(body.instances) ? body.instances : []);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Sales channels could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const params = new URLSearchParams(window.location.search);
    const success = params.get('amazonSuccess');
    const failure = params.get('amazonError');
    if (success) setNotice(success);
    if (failure) setError(failure);
    if (success || failure) window.history.replaceState(window.history.state, '', `${window.location.pathname}#sales-channels`);
    return () => controller.abort();
  }, []);

  const renameInstance = async (instance: ChannelInstance) => {
    setSavingId(instance.channelInstanceId);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: draftName }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Sales channel could not be updated.');
      setEditingId(null);
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Sales channel could not be updated.');
    } finally {
      setSavingId(null);
    }
  };

  const testConnection = async (instance: ChannelInstance) => {
    setTestingId(instance.channelInstanceId);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/test`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Connection test failed.');
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Connection test failed.');
      await load();
    } finally {
      setTestingId(null);
    }
  };

  const syncAmazonListings = async (instance: ChannelInstance) => {
    setSyncingId(instance.channelInstanceId);
    setError('');
    setNotice('');
    try {
      let nextToken: string | null = null;
      let pageCount = 0;
      const totals = { processed: 0, linked: 0, unmatched: 0, conflicts: 0 };
      do {
        const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/listings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageSize: 20, nextToken }),
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Amazon listings could not be synchronized.');
        totals.processed += Number(body.processed ?? 0);
        totals.linked += Number(body.linked ?? 0);
        totals.unmatched += Number(body.unmatched ?? 0);
        totals.conflicts += Number(body.conflicts ?? 0);
        nextToken = typeof body.nextToken === 'string' && body.nextToken ? body.nextToken : null;
        pageCount++;
        if (pageCount >= 500 && nextToken) throw new Error('Amazon returned too many listing pages. Run sync again to continue.');
      } while (nextToken);
      setNotice(`${instance.displayName}: ${totals.processed} listings checked, ${totals.linked} linked, ${totals.unmatched} unmatched, ${totals.conflicts} conflicts.`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Amazon listings could not be synchronized.');
    } finally {
      setSyncingId(null);
    }
  };

  const syncAmazonInventory = async (instance: ChannelInstance) => {
    setInventorySyncingId(instance.channelInstanceId);
    setError('');
    setNotice('');
    try {
      const totals = { processed: 0, pushed: 0, skipped: 0, failed: 0 };
      let enqueue = true;
      for (let batch = 0; batch < 20; batch++) {
        const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/inventory`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enqueue, limit: 100 }),
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Amazon inventory could not be synchronized.');
        totals.processed += Number(body.processed ?? 0);
        totals.pushed += Number(body.pushed ?? 0);
        totals.skipped += Number(body.skipped ?? 0);
        totals.failed += Number(body.failed ?? 0);
        enqueue = false;
        if (Number(body.processed ?? 0) < 100) break;
        if (batch === 19) throw new Error('Amazon inventory has more work remaining. Run sync again to continue.');
      }
      setNotice(`${instance.displayName}: ${totals.pushed} inventory levels pushed, ${totals.skipped} skipped, ${totals.failed} queued for retry.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Amazon inventory could not be synchronized.');
    } finally {
      setInventorySyncingId(null);
    }
  };

  const openAmazonOrderSettings = async (instance: ChannelInstance) => {
    setOrderSettingsInstance(instance);
    setOrderSettingsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/orders/settings`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon order settings could not be loaded.');
      setOrderLocations(Array.isArray(body.locations) ? body.locations : []);
      setOrderLocationId(body.orderLocationId ? String(body.orderLocationId) : '');
    } catch (settingsError) {
      setOrderSettingsInstance(null);
      setError(settingsError instanceof Error ? settingsError.message : 'Amazon order settings could not be loaded.');
    } finally {
      setOrderSettingsLoading(false);
    }
  };

  const saveAmazonOrderSettings = async () => {
    if (!orderSettingsInstance || !orderLocationId) return;
    setOrderSettingsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(orderSettingsInstance.channelInstanceId)}/amazon/orders/settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderLocationId: Number(orderLocationId) }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon order settings could not be saved.');
      setInstances(current => current.map(instance => instance.channelInstanceId === orderSettingsInstance.channelInstanceId
        ? { ...instance, settings: { ...instance.settings, orderLocationId: Number(orderLocationId) } }
        : instance));
      setNotice(`${orderSettingsInstance.displayName}: dispatch location saved.`);
      setOrderSettingsInstance(null);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Amazon order settings could not be saved.');
    } finally {
      setOrderSettingsLoading(false);
    }
  };

  const syncAmazonOrders = async (instance: ChannelInstance) => {
    if (!Number(instance.settings?.orderLocationId ?? 0)) {
      await openAmazonOrderSettings(instance);
      return;
    }
    setOrderSyncingId(instance.channelInstanceId);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 25 }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon orders could not be synchronized.');
      const more = body.hasMore ? ' More updates remain; run Sync orders again.' : '';
      setNotice(`${instance.displayName}: ${Number(body.imported ?? 0)} orders imported, ${Number(body.updated ?? 0)} updated, ${Number(body.skipped ?? 0)} unchanged.${more}`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Amazon orders could not be synchronized.');
    } finally {
      setOrderSyncingId(null);
    }
  };

  const syncAmazonReturns = async (instance: ChannelInstance) => {
    setReturnSyncingId(instance.channelInstanceId);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/returns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon returns could not be synchronized.');
      const returnsState = body.returns?.state === 'requested' ? 'return report requested'
        : body.returns?.state === 'pending' ? 'return report pending' : `${Number(body.returns?.observed ?? 0)} returns observed`;
      setNotice(`${instance.displayName}: ${returnsState}; ${Number(body.refunds?.observed ?? 0)} refunds observed, ${Number(body.refunds?.created ?? 0)} review drafts created, ${Number(body.refunds?.ambiguous ?? 0)} ambiguous.`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Amazon returns could not be synchronized.');
    } finally {
      setReturnSyncingId(null);
    }
  };

  const openAmazonMappings = async (instance: ChannelInstance) => {
    setMappingInstance(instance);
    setMappings([]);
    setMappingIds(new Set());
    setMappingLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/amazon/mappings`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon product mappings could not be loaded.');
      setMappings(Array.isArray(body.mappings) ? body.mappings : []);
    } catch (mappingError) {
      setMappingInstance(null);
      setError(mappingError instanceof Error ? mappingError.message : 'Amazon product mappings could not be loaded.');
    } finally {
      setMappingLoading(false);
    }
  };

  const updateAmazonMappings = async (changes: { selected?: boolean; inventoryEnabled?: boolean }) => {
    if (!mappingInstance || mappingIds.size === 0) return;
    setMappingLoading(true);
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(mappingInstance.channelInstanceId)}/amazon/mappings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappingIds: [...mappingIds], ...changes }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Amazon product controls could not be saved.');
      setMappings(current => current.map(mapping => mappingIds.has(mapping.mappingId) && mapping.status === 'linked'
        ? { ...mapping,
          selected: changes.selected ?? (changes.inventoryEnabled === true ? true : mapping.selected),
          inventoryEnabled: changes.inventoryEnabled ?? mapping.inventoryEnabled } : mapping));
      setMappingIds(new Set());
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : 'Amazon product controls could not be saved.');
    } finally {
      setMappingLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 22, fontWeight: 750 }}>Sales Channels</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>Connected storefronts and their current operating state.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && (
            <button type="button" onClick={() => setAmazonDialogOpen(true)} style={{ minHeight: 36, padding: '0 12px', border: 0, borderRadius: 6, background: '#111827', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>
              <Plus size={15} aria-hidden="true" /> Connect Amazon
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh sales channels"
            aria-label="Refresh sales channels"
            style={{ width: 36, height: 36, border: '1px solid var(--sv-border)', borderRadius: 6, background: '#fff', color: 'var(--sv-text)', display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer' }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', marginBottom: 16, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', fontSize: 13 }}>
          <CheckCircle2 size={17} aria-hidden="true" /> <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" onClick={() => setNotice('')} title="Dismiss" aria-label="Dismiss message" style={{ width: 26, height: 26, border: 0, background: 'transparent', color: '#166534', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={15} /></button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', marginBottom: 16, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>
          <AlertCircle size={17} aria-hidden="true" />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => void load()} style={{ border: 0, background: 'transparent', color: '#991b1b', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {loading && instances.length === 0 ? (
        <div style={{ padding: '48px 0', color: 'var(--sv-text-dim)', textAlign: 'center', fontSize: 13 }}>Loading sales channels...</div>
      ) : !error && instances.length === 0 ? (
        <div style={{ padding: '52px 20px', borderTop: '1px solid var(--sv-border)', borderBottom: '1px solid var(--sv-border)', textAlign: 'center' }}>
          <Store size={24} aria-hidden="true" style={{ margin: '0 auto 10px', color: 'var(--sv-text-dim)' }} />
          <div style={{ color: 'var(--sv-text-strong)', fontWeight: 700 }}>No sales channels</div>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--sv-border)' }}>
          {instances.map(instance => {
            const status = statusDetails(instance);
            const StatusIcon = status.icon;
            const capabilities = CAPABILITY_LABELS.filter(([key]) => instance.capabilities[key]);
            return (
              <section key={instance.channelInstanceId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 22, padding: '20px 4px', borderBottom: '1px solid var(--sv-border)', alignItems: 'start' }}>
                <div style={{ display: 'flex', gap: 11, minWidth: 0 }}>
                  <div style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', background: '#eef6f8', color: '#147d92' }}>
                    <Store size={18} aria-hidden="true" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {editingId === instance.channelInstanceId ? (
                      <form
                        onSubmit={event => {
                          event.preventDefault();
                          void renameInstance(instance);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <input
                          autoFocus
                          value={draftName}
                          maxLength={120}
                          onChange={event => setDraftName(event.target.value)}
                          aria-label="Channel name"
                          style={{ width: '100%', minWidth: 0, height: 30, padding: '0 8px', border: '1px solid var(--sv-border)', borderRadius: 4, color: 'var(--sv-text-strong)', background: '#fff', fontSize: 13 }}
                        />
                        <button type="submit" disabled={savingId === instance.channelInstanceId || !draftName.trim()} title="Save channel name" aria-label="Save channel name" style={{ width: 30, height: 30, border: 0, background: '#e0f2fe', color: '#0369a1', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Check size={15} /></button>
                        <button type="button" onClick={() => setEditingId(null)} title="Cancel rename" aria-label="Cancel rename" style={{ width: 30, height: 30, border: 0, background: '#f1f5f9', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={15} /></button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ color: 'var(--sv-text-strong)', fontSize: 14, fontWeight: 750, overflowWrap: 'anywhere' }}>{instance.displayName}</div>
                        {canManage && (
                          <button type="button" onClick={() => { setEditingId(instance.channelInstanceId); setDraftName(instance.displayName); }} title="Rename channel" aria-label={`Rename ${instance.displayName}`} style={{ width: 26, height: 26, flexShrink: 0, border: 0, background: 'transparent', color: 'var(--sv-text-dim)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Pencil size={14} /></button>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 3, color: 'var(--sv-text-dim)', fontSize: 12 }}>{instance.providerDisplayName}</div>
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 7px', borderRadius: 4, color: status.color, background: status.background, fontSize: 11, fontWeight: 750 }}>
                      <StatusIcon size={13} aria-hidden="true" /> {status.label}
                    </span>
                    <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{formatLastSync(instance.lastSyncAt)}</span>
                  </div>
                  {instance.externalAccountKey && <div style={{ marginTop: 8, color: 'var(--sv-text)', fontSize: 12, overflowWrap: 'anywhere' }}>{instance.externalAccountKey}</div>}
                  {instance.safeError && <div style={{ marginTop: 8, color: '#b91c1c', fontSize: 12, lineHeight: 1.45 }}>{instance.safeError}</div>}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {capabilities.map(([key, label]) => (
                    <span key={key} style={{ padding: '4px 7px', border: '1px solid var(--sv-border)', borderRadius: 4, color: 'var(--sv-text-dim)', background: '#fff', fontSize: 11 }}>{label}</span>
                  ))}
                  {canManage && (instance.provider === 'shopify' || instance.provider === 'amazon') && (
                    <button
                      type="button"
                      disabled={testingId === instance.channelInstanceId}
                      onClick={() => void testConnection(instance)}
                      style={{ marginLeft: 'auto', minHeight: 29, padding: '4px 9px', border: '1px solid var(--sv-border)', borderRadius: 4, color: '#0369a1', background: '#f0f9ff', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: testingId === instance.channelInstanceId ? 'wait' : 'pointer' }}
                    >
                      <TestTube2 size={14} aria-hidden="true" />
                      {testingId === instance.channelInstanceId ? 'Testing...' : 'Test connection'}
                    </button>
                  )}
                  {instance.provider === 'amazon' && capabilities.length === 0 && (
                    <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Operational setup pending</span>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button
                      type="button"
                      disabled={syncingId === instance.channelInstanceId}
                      onClick={() => void syncAmazonListings(instance)}
                      style={{ minHeight: 29, padding: '4px 9px', border: '1px solid var(--sv-border)', borderRadius: 4, color: '#166534', background: '#f0fdf4', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: syncingId === instance.channelInstanceId ? 'wait' : 'pointer' }}
                    >
                      <Download size={14} aria-hidden="true" />
                      {syncingId === instance.channelInstanceId ? 'Syncing...' : 'Sync listings'}
                    </button>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button type="button" onClick={() => void openAmazonMappings(instance)} style={{ minHeight: 29, padding: '4px 9px', border: '1px solid var(--sv-border)', borderRadius: 4, color: '#334155', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <ListChecks size={14} aria-hidden="true" /> Manage listings
                    </button>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button type="button" disabled={inventorySyncingId === instance.channelInstanceId} onClick={() => void syncAmazonInventory(instance)} style={{ minHeight: 29, padding: '4px 9px', border: '1px solid var(--sv-border)', borderRadius: 4, color: '#9a3412', background: '#fff7ed', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: inventorySyncingId === instance.channelInstanceId ? 'wait' : 'pointer' }}>
                      <RefreshCw size={14} aria-hidden="true" /> {inventorySyncingId === instance.channelInstanceId ? 'Syncing...' : 'Sync inventory'}
                    </button>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button type="button" onClick={() => void openAmazonOrderSettings(instance)} style={{ minHeight: 29, padding: '4px 9px', border: '1px solid var(--sv-border)', borderRadius: 4, color: '#334155', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <MapPin size={14} aria-hidden="true" /> Order setup
                    </button>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button type="button" disabled={orderSyncingId === instance.channelInstanceId} onClick={() => void syncAmazonOrders(instance)} style={{ minHeight: 29, padding: '4px 9px', border: '1px solid #bae6fd', borderRadius: 4, color: '#075985', background: '#f0f9ff', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: orderSyncingId === instance.channelInstanceId ? 'wait' : 'pointer' }}>
                      <ShoppingBag size={14} aria-hidden="true" /> {orderSyncingId === instance.channelInstanceId ? 'Syncing...' : 'Sync orders'}
                    </button>
                  )}
                  {canManage && instance.provider === 'amazon' && (
                    <button type="button" disabled={returnSyncingId === instance.channelInstanceId} onClick={() => void syncAmazonReturns(instance)} style={{ minHeight: 29, padding: '4px 9px', border: '1px solid #fecdd3', borderRadius: 4, color: '#9f1239', background: '#fff1f2', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: returnSyncingId === instance.channelInstanceId ? 'wait' : 'pointer' }}>
                      <RotateCcw size={14} aria-hidden="true" /> {returnSyncingId === instance.channelInstanceId ? 'Syncing...' : 'Sync returns'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {amazonDialogOpen && (
        <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAmazonDialogOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,.46)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-amazon-title"
            onSubmit={event => {
              event.preventDefault();
              const name = amazonDisplayName.trim();
              if (!name) return;
              window.location.assign(`/api/ims/amazon/connect?displayName=${encodeURIComponent(name)}`);
            }}
            style={{ width: 'min(440px, 100%)', background: '#fff', border: '1px solid var(--sv-border)', borderRadius: 8, boxShadow: '0 24px 70px rgba(15,23,42,.24)', padding: 22 }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 id="connect-amazon-title" style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 17 }}>Connect Amazon Australia</h2>
                <p style={{ margin: '6px 0 0', color: 'var(--sv-text-dim)', fontSize: 12, lineHeight: 1.5 }}>You will sign in to Seller Central and authorize Solvantis for one seller account.</p>
              </div>
              <button type="button" onClick={() => setAmazonDialogOpen(false)} title="Close" aria-label="Close Amazon connection" style={{ width: 30, height: 30, border: 0, background: '#f1f5f9', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <label htmlFor="amazon-channel-name" style={{ display: 'block', marginTop: 18, color: 'var(--sv-text)', fontSize: 12, fontWeight: 700 }}>Channel name</label>
            <input id="amazon-channel-name" autoFocus maxLength={120} value={amazonDisplayName} onChange={event => setAmazonDisplayName(event.target.value)} style={{ width: '100%', height: 38, marginTop: 6, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 5, color: 'var(--sv-text-strong)', background: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" onClick={() => setAmazonDialogOpen(false)} style={{ minHeight: 36, padding: '0 12px', border: '1px solid var(--sv-border)', borderRadius: 5, background: '#fff', color: 'var(--sv-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={!amazonDisplayName.trim()} style={{ minHeight: 36, padding: '0 13px', border: 0, borderRadius: 5, background: '#111827', color: '#fff', fontSize: 12, fontWeight: 750, cursor: amazonDisplayName.trim() ? 'pointer' : 'not-allowed', opacity: amazonDisplayName.trim() ? 1 : .55 }}>Continue to Amazon</button>
            </div>
          </form>
        </div>
      )}

      {mappingInstance && (
        <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setMappingInstance(null); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,.46)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="amazon-mappings-title" style={{ width: 'min(920px, 100%)', maxHeight: 'min(760px, calc(100vh - 36px))', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid var(--sv-border)', borderRadius: 8, boxShadow: '0 24px 70px rgba(15,23,42,.24)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid var(--sv-border)' }}>
              <div>
                <h2 id="amazon-mappings-title" style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 17 }}>{mappingInstance.displayName} listings</h2>
                <p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Only one-to-one SKU matches can be included.</p>
              </div>
              <button type="button" onClick={() => setMappingInstance(null)} title="Close" aria-label="Close Amazon listings" style={{ width: 30, height: 30, border: 0, background: '#f1f5f9', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 22px', borderBottom: '1px solid var(--sv-border)' }}>
              <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{mappingIds.size} selected</span>
              <button type="button" disabled={mappingLoading || mappingIds.size === 0} onClick={() => void updateAmazonMappings({ selected: true })} style={{ minHeight: 30, padding: '0 10px', border: 0, borderRadius: 4, background: '#166534', color: '#fff', fontSize: 11, fontWeight: 700, cursor: mappingIds.size ? 'pointer' : 'not-allowed', opacity: mappingIds.size ? 1 : .55 }}>Include</button>
              <button type="button" disabled={mappingLoading || mappingIds.size === 0} onClick={() => void updateAmazonMappings({ selected: false, inventoryEnabled: false })} style={{ minHeight: 30, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff', color: 'var(--sv-text)', fontSize: 11, fontWeight: 700, cursor: mappingIds.size ? 'pointer' : 'not-allowed', opacity: mappingIds.size ? 1 : .55 }}>Exclude</button>
              <button type="button" disabled={mappingLoading || mappingIds.size === 0} onClick={() => void updateAmazonMappings({ inventoryEnabled: true })} style={{ minHeight: 30, padding: '0 10px', border: '1px solid #fed7aa', borderRadius: 4, background: '#fff7ed', color: '#9a3412', fontSize: 11, fontWeight: 700, cursor: mappingIds.size ? 'pointer' : 'not-allowed', opacity: mappingIds.size ? 1 : .55 }}>Inventory on</button>
              <button type="button" disabled={mappingLoading || mappingIds.size === 0} onClick={() => void updateAmazonMappings({ inventoryEnabled: false })} style={{ minHeight: 30, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff', color: 'var(--sv-text)', fontSize: 11, fontWeight: 700, cursor: mappingIds.size ? 'pointer' : 'not-allowed', opacity: mappingIds.size ? 1 : .55 }}>Inventory off</button>
              <button type="button" disabled={mappingLoading} onClick={() => setMappingIds(new Set(mappings.filter(mapping => mapping.status === 'linked').map(mapping => mapping.mappingId)))} style={{ minHeight: 30, marginLeft: 'auto', padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 4, background: '#fff', color: 'var(--sv-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Select linked</button>
            </div>
            <div style={{ overflow: 'auto', minHeight: 160 }}>
              <div style={{ minWidth: 700 }}>
                <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: '40px minmax(170px, 1fr) 150px 140px 100px', gap: 12, padding: '9px 22px', background: '#f8fafc', borderBottom: '1px solid var(--sv-border)', color: '#475569', fontSize: 11, fontWeight: 750 }}>
                  <span /><span>Listing</span><span>Seller SKU</span><span>IMS SKU</span><span>Status</span>
                </div>
                {mappingLoading && mappings.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading listings...</div>
                  : mappings.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>No listings synchronized yet.</div>
                    : mappings.map(mapping => {
                      const eligible = mapping.status === 'linked';
                      return <div key={mapping.mappingId} style={{ display: 'grid', gridTemplateColumns: '40px minmax(170px, 1fr) 150px 140px 100px', gap: 12, alignItems: 'center', padding: '10px 22px', borderBottom: '1px solid #eef2f7', fontSize: 12 }}>
                        <input type="checkbox" disabled={!eligible} checked={mappingIds.has(mapping.mappingId)} onChange={event => setMappingIds(current => { const next = new Set(current); if (event.target.checked) next.add(mapping.mappingId); else next.delete(mapping.mappingId); return next; })} aria-label={`Select ${mapping.sellerSku}`} />
                        <span style={{ minWidth: 0 }}><strong style={{ display: 'block', color: 'var(--sv-text-strong)', overflowWrap: 'anywhere' }}>{mapping.itemName || mapping.productName || 'Unnamed listing'}</strong><span style={{ color: 'var(--sv-text-dim)' }}>{mapping.asin || 'No ASIN'}</span></span>
                        <span style={{ overflowWrap: 'anywhere' }}>{mapping.sellerSku}</span>
                        <span style={{ overflowWrap: 'anywhere' }}>{mapping.imsSku || 'Not linked'}</span>
                        <span style={{ color: mapping.status === 'linked' ? '#166534' : mapping.status === 'conflict' ? '#b91c1c' : '#92400e', fontWeight: 700 }}>{mapping.inventoryEnabled ? 'Inventory on' : mapping.selected ? 'Included' : mapping.status}</span>
                      </div>;
                    })}
              </div>
            </div>
          </div>
        </div>
      )}

      {orderSettingsInstance && (
        <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !orderSettingsLoading) setOrderSettingsInstance(null); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,.46)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <form role="dialog" aria-modal="true" aria-labelledby="amazon-order-settings-title" onSubmit={event => { event.preventDefault(); void saveAmazonOrderSettings(); }} style={{ width: 'min(440px, 100%)', background: '#fff', border: '1px solid var(--sv-border)', borderRadius: 8, boxShadow: '0 24px 70px rgba(15,23,42,.24)', padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 id="amazon-order-settings-title" style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 17 }}>{orderSettingsInstance.displayName} order setup</h2>
                <p style={{ margin: '6px 0 0', color: 'var(--sv-text-dim)', fontSize: 12, lineHeight: 1.5 }}>Choose the IMS location that owns stock commitments and dispatch for this seller account.</p>
              </div>
              <button type="button" disabled={orderSettingsLoading} onClick={() => setOrderSettingsInstance(null)} title="Close" aria-label="Close Amazon order setup" style={{ width: 30, height: 30, border: 0, background: '#f1f5f9', color: '#475569', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <label htmlFor="amazon-order-location" style={{ display: 'block', marginTop: 18, color: 'var(--sv-text)', fontSize: 12, fontWeight: 700 }}>Dispatch location</label>
            <select id="amazon-order-location" value={orderLocationId} disabled={orderSettingsLoading} onChange={event => setOrderLocationId(event.target.value)} style={{ width: '100%', height: 38, marginTop: 6, padding: '0 10px', border: '1px solid var(--sv-border)', borderRadius: 5, color: 'var(--sv-text-strong)', background: '#fff', fontSize: 13 }}>
              <option value="">Choose a location</option>
              {orderLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" disabled={orderSettingsLoading} onClick={() => setOrderSettingsInstance(null)} style={{ minHeight: 36, padding: '0 12px', border: '1px solid var(--sv-border)', borderRadius: 5, background: '#fff', color: 'var(--sv-text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={orderSettingsLoading || !orderLocationId} style={{ minHeight: 36, padding: '0 13px', border: 0, borderRadius: 5, background: '#111827', color: '#fff', fontSize: 12, fontWeight: 750, cursor: orderSettingsLoading || !orderLocationId ? 'not-allowed' : 'pointer', opacity: orderSettingsLoading || !orderLocationId ? .55 : 1 }}>{orderSettingsLoading ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
