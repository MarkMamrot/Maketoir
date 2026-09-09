'use client';

import { AlertCircle, Check, CheckCircle2, Clock3, Pencil, PauseCircle, RefreshCw, Store, TestTube2, X } from 'lucide-react';
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
  capabilities: ChannelCapabilities;
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

  return (
    <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 22, fontWeight: 750 }}>Sales Channels</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>Connected storefronts and their current operating state.</p>
        </div>
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
                  {canManage && instance.provider === 'shopify' && (
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
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
