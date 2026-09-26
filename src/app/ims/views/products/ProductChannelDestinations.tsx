'use client';

import { Check, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { evaluateChannelProductRules, type ChannelProductRuleContext, type ChannelProductRuleDefinition } from '@/lib/channels/channelProductRules';

type OverrideMode = 'automatic' | 'include' | 'exclude';
type Destination = {
  channelInstanceId: string;
  displayName: string;
  providerDisplayName: string;
  enabled: boolean;
  runtimeStatus: string;
  readinessStatus: string;
  safeError: string | null;
  assignmentMode: 'manual' | 'add_matches';
  ruleDecision: 'include' | 'exclude';
  effectiveDecision: 'include' | 'exclude';
  matchedRuleName: string | null;
  overrideMode: OverrideMode;
  desiredState: 'published' | 'unpublished';
  providerState: string;
  storefrontUrl?: string | null;
  adminUrl?: string | null;
};

export function ProductChannelDestinations({ productId, isReadOnly = false }: {
  productId: string;
  isReadOnly?: boolean;
}) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/products/${encodeURIComponent(productId)}/channel-destinations`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Channel destinations could not be loaded.');
      const loaded = Array.isArray(body.destinations) ? body.destinations : [];
      setDestinations(loaded);
      setSelectedChannels(new Set(loaded.filter((item: Destination) => item.desiredState === 'published')
        .map((item: Destination) => item.channelInstanceId)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Channel destinations could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const applySelection = async () => {
    const included = destinations.filter(destination => selectedChannels.has(destination.channelInstanceId)
      && destination.desiredState !== 'published').map(destination => destination.channelInstanceId);
    const excluded = destinations.filter(destination => !selectedChannels.has(destination.channelInstanceId)
      && destination.desiredState === 'published').map(destination => destination.channelInstanceId);
    if (excluded.length > 0 && !window.confirm(`Remove this product from ${excluded.length} sales channel${excluded.length === 1 ? '' : 's'}?`)) return;
    setUpdatingId('bulk');
    setError('');
    try {
      for (const [channelInstanceIds, action] of [[included, 'include'], [excluded, 'exclude']] as const) {
        if (channelInstanceIds.length === 0) continue;
        const response = await fetch('/api/ims/products/channel-assignments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: [productId], channelInstanceIds, action }),
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'One or more channel assignments could not be saved.');
      }
      setPickerOpen(false);
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Channel assignments could not be saved.');
      await load();
    } finally {
      setUpdatingId(null);
    }
  };

  const applyRecommendations = () => {
    const next = new Set(selectedChannels);
    for (const destination of destinations) {
      if (destination.overrideMode !== 'automatic') continue;
      if (destination.ruleDecision === 'include') next.add(destination.channelInstanceId);
      else next.delete(destination.channelInstanceId);
    }
    setSelectedChannels(next);
  };

  useEffect(() => { void load(); }, [productId]);

  const setOverride = async (destination: Destination, overrideMode: OverrideMode) => {
    setUpdatingId(destination.channelInstanceId);
    setError('');
    try {
      const response = await fetch(`/api/ims/channels/${encodeURIComponent(destination.channelInstanceId)}/product-rules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, overrideMode }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Product override could not be saved.');
      setDestinations(current => current.map(item => item.channelInstanceId === destination.channelInstanceId ? {
        ...item,
        overrideMode,
        effectiveDecision: overrideMode === 'automatic' ? item.ruleDecision : overrideMode,
      } : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Product override could not be saved.');
    } finally {
      setUpdatingId(null);
    }
  };

  return <section style={{ marginBottom: 16, borderTop: '1px solid var(--sv-etch)', paddingTop: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
      <div>
        <h4 style={{ margin: 0, fontSize: 13, color: 'var(--sv-text-strong)' }}>Channels</h4>
        <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Including a product publishes it to the selected ready channel.</span>
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        {!isReadOnly && <button type="button" onClick={() => setPickerOpen(true)} disabled={loading || destinations.length === 0} style={{ height: 30, padding: '0 10px', border: 'none', borderRadius: 4, background: 'var(--sv-action)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Include in Channels</button>}
        <button type="button" onClick={() => void load()} disabled={loading || updatingId !== null} title="Refresh channels" aria-label="Refresh channels" style={{ width: 30, height: 30, border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-dim)', display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer' }}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
    {error && <div role="alert" style={{ padding: '8px 10px', background: '#fef2f2', color: '#991b1b', fontSize: 11 }}>{error}</div>}
    {loading ? <div style={{ padding: '10px 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading destinations...</div>
      : destinations.length === 0 ? <div style={{ padding: '10px 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>No sales channels are configured.</div>
        : <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, overflowX: 'auto' }}>
          <div style={{ minWidth: 650 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) 105px minmax(150px, 1fr) 125px 105px', gap: 10, padding: '7px 10px', background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700 }}>
              <span>Sales channel</span><span>Included</span><span>Rule recommendation</span><span>Control</span><span>Provider</span>
            </div>
            {destinations.map(destination => <div key={destination.channelInstanceId} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) 105px minmax(150px, 1fr) 125px 105px', gap: 10, alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--sv-etch)', fontSize: 11 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{destination.displayName}</strong>
                <span style={{ color: 'var(--sv-text-dim)' }}>{destination.providerDisplayName}</span>
                {(destination.storefrontUrl || destination.adminUrl) && <span style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                  {destination.storefrontUrl && <a href={destination.storefrontUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sv-action)' }}>View listing</a>}
                  {destination.adminUrl && <a href={destination.adminUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sv-text-dim)' }}>Manage listing</a>}
                </span>}
              </div>
              <strong style={{ color: destination.desiredState === 'published' ? '#166534' : '#64748b' }}>{destination.desiredState === 'published' ? 'Included' : 'Not included'}</strong>
              <span style={{ overflowWrap: 'anywhere', color: destination.ruleDecision === 'include' ? '#166534' : 'var(--sv-text-dim)' }}>{destination.ruleDecision === 'include' ? 'Recommended' : 'Not recommended'}{destination.matchedRuleName ? ` · ${destination.matchedRuleName}` : ''}</span>
              <select aria-label={`${destination.displayName} override`} value={destination.overrideMode} disabled={isReadOnly || updatingId === destination.channelInstanceId} onChange={event => void setOverride(destination, event.target.value as OverrideMode)} style={{ width: '100%', height: 29, border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 11 }}>
                <option value="automatic">Follow channel mode</option><option value="include">Always include</option><option value="exclude">Always exclude</option>
              </select>
              <span style={{ color: destination.providerState === 'error' ? '#991b1b' : 'var(--sv-text-dim)', textTransform: 'capitalize' }}>{destination.providerState.replaceAll('_', ' ')}</span>
            </div>)}
          </div>
        </div>}
    {pickerOpen && <div role="dialog" aria-modal="true" aria-label="Include in Channels" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.48)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: 'min(540px, 100%)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: 18, boxShadow: '0 20px 50px rgba(0,0,0,.3)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Include in Channels</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>Apply publishes checked products and removes unchecked products from each selected channel. Rule recommendations are shown separately.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {destinations.map(destination => {
            const available = destination.enabled && destination.runtimeStatus === 'active' && destination.readinessStatus === 'ready';
            return <label key={destination.channelInstanceId} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 9, alignItems: 'center', padding: '9px 10px', border: '1px solid var(--sv-etch)', borderRadius: 5, opacity: available ? 1 : .62 }}>
              <input type="checkbox" checked={selectedChannels.has(destination.channelInstanceId)} disabled={!available}
                onChange={event => setSelectedChannels(current => { const next = new Set(current); if (event.target.checked) next.add(destination.channelInstanceId); else next.delete(destination.channelInstanceId); return next; })} />
              <span><strong style={{ display: 'block', fontSize: 12 }}>{destination.displayName}</strong><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{destination.providerDisplayName}{!available ? ` · ${destination.safeError || 'Channel is not active and ready'}` : ''}</span></span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: destination.ruleDecision === 'include' ? '#166534' : '#64748b', fontSize: 10, fontWeight: 700 }}>{destination.ruleDecision === 'include' && <Check size={12} />} {destination.ruleDecision === 'include' ? 'Recommended' : 'Not recommended'}</span>
            </label>;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={applyRecommendations} style={{ padding: '7px 10px', border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 11, fontWeight: 700 }}>Apply rule recommendations</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => { setSelectedChannels(new Set(destinations.filter(item => item.desiredState === 'published').map(item => item.channelInstanceId))); setPickerOpen(false); }} style={{ padding: '7px 10px', border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)' }}>Cancel</button>
            <button type="button" onClick={() => void applySelection()} disabled={updatingId === 'bulk'} style={{ padding: '7px 12px', border: 0, borderRadius: 4, background: 'var(--sv-action)', color: '#fff', fontWeight: 700 }}>{updatingId === 'bulk' ? 'Publishing...' : 'Apply and publish'}</button>
          </div>
        </div>
      </div>
    </div>}
  </section>;
}

type DraftChannel = {
  channelInstanceId: string;
  displayName: string;
  providerDisplayName: string;
  enabled: boolean;
  runtimeStatus: string;
  readinessStatus: string;
  safeError: string | null;
  recommended: boolean;
  matchedRuleName: string | null;
};

export function NewProductChannelChoices({ context, selectedChannelIds, onChange, isReadOnly = false }: {
  context: ChannelProductRuleContext;
  selectedChannelIds: string[];
  onChange: (channelInstanceIds: string[]) => void;
  isReadOnly?: boolean;
}) {
  const [channels, setChannels] = useState<DraftChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const contextKey = JSON.stringify(context);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/ims/channels');
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Sales channels could not be loaded.');
        const instances = Array.isArray(body.instances) ? body.instances : [];
        const loaded = await Promise.all(instances.map(async (instance: any): Promise<DraftChannel> => {
          const rulesResponse = await fetch(`/api/ims/channels/${encodeURIComponent(instance.channelInstanceId)}/product-rules?limit=1`);
          const rulesBody = await rulesResponse.json();
          if (!rulesResponse.ok || !rulesBody.success) throw new Error(rulesBody.error || 'Channel rules could not be loaded.');
          const rules = Array.isArray(rulesBody.rules) ? rulesBody.rules as ChannelProductRuleDefinition[] : [];
          const evaluation = evaluateChannelProductRules({ context, rules });
          return {
            channelInstanceId: instance.channelInstanceId,
            displayName: instance.displayName,
            providerDisplayName: instance.providerDisplayName,
            enabled: instance.enabled,
            runtimeStatus: instance.runtimeStatus,
            readinessStatus: instance.readinessStatus,
            safeError: instance.safeError ?? null,
            recommended: evaluation.ruleDecision === 'include',
            matchedRuleName: evaluation.matchedRuleName,
          };
        }));
        if (!cancelled) setChannels(loaded);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Sales channels could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [contextKey]);

  const selected = new Set(selectedChannelIds);
  const setSelected = (channelInstanceId: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(channelInstanceId); else next.delete(channelInstanceId);
    onChange([...next]);
  };

  return <section style={{ marginBottom: 16, borderTop: '1px solid var(--sv-etch)', paddingTop: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
      <div><h4 style={{ margin: 0, fontSize: 13 }}>Include in Channels</h4><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Choices will be applied after the product is created.</span></div>
      {!isReadOnly && <button type="button" disabled={loading} onClick={() => onChange(channels.filter(channel => channel.recommended && channel.enabled && channel.runtimeStatus === 'active' && channel.readinessStatus === 'ready').map(channel => channel.channelInstanceId))} style={{ padding: '6px 9px', border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 11, fontWeight: 700 }}>Apply rule recommendations</button>}
    </div>
    {error && <div role="alert" style={{ color: '#991b1b', fontSize: 11 }}>{error}</div>}
    {loading ? <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading channels...</div>
      : channels.length === 0 ? <div style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>No sales channels are configured.</div>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {channels.map(channel => {
            const available = channel.enabled && channel.runtimeStatus === 'active' && channel.readinessStatus === 'ready';
            return <label key={channel.channelInstanceId} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 9, alignItems: 'center', padding: '9px 10px', border: '1px solid var(--sv-etch)', borderRadius: 5, opacity: available ? 1 : .62 }}>
              <input type="checkbox" checked={selected.has(channel.channelInstanceId)} disabled={isReadOnly || !available} onChange={event => setSelected(channel.channelInstanceId, event.target.checked)} />
              <span><strong style={{ display: 'block', fontSize: 12 }}>{channel.displayName}</strong><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{channel.providerDisplayName}{!available ? ` · ${channel.safeError || 'Channel is not active and ready'}` : ''}</span></span>
              <span style={{ color: channel.recommended ? '#166534' : '#64748b', fontSize: 10, fontWeight: 700 }}>{channel.recommended ? 'Recommended' : 'Not recommended'}{channel.matchedRuleName ? ` · ${channel.matchedRuleName}` : ''}</span>
            </label>;
          })}
        </div>}
  </section>;
}