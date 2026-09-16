'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

type OverrideMode = 'automatic' | 'include' | 'exclude';
type Destination = {
  channelInstanceId: string;
  displayName: string;
  providerDisplayName: string;
  runtimeStatus: string;
  readinessStatus: string;
  ruleDecision: 'include' | 'exclude';
  effectiveDecision: 'include' | 'exclude';
  matchedRuleName: string | null;
  overrideMode: OverrideMode;
  providerState: string;
};

export function ProductChannelDestinations({ productId, isReadOnly = false }: {
  productId: string;
  isReadOnly?: boolean;
}) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/products/${encodeURIComponent(productId)}/channel-destinations`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Channel destinations could not be loaded.');
      setDestinations(Array.isArray(body.destinations) ? body.destinations : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Channel destinations could not be loaded.');
    } finally {
      setLoading(false);
    }
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
        <h4 style={{ margin: 0, fontSize: 13, color: 'var(--sv-text-strong)' }}>Channel destinations</h4>
        <span style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Saved catalogue result</span>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || updatingId !== null} title="Refresh channel destinations" aria-label="Refresh channel destinations" style={{ width: 30, height: 30, border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-dim)', display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer' }}>
        <RefreshCw size={14} aria-hidden="true" />
      </button>
    </div>
    {error && <div role="alert" style={{ padding: '8px 10px', background: '#fef2f2', color: '#991b1b', fontSize: 11 }}>{error}</div>}
    {loading ? <div style={{ padding: '10px 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading destinations...</div>
      : destinations.length === 0 ? <div style={{ padding: '10px 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>No sales channels are configured.</div>
        : <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, overflowX: 'auto' }}>
          <div style={{ minWidth: 650 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) 110px minmax(140px, 1fr) 125px 105px', gap: 10, padding: '7px 10px', background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700 }}>
              <span>Storefront</span><span>Destination</span><span>Matched rule</span><span>Override</span><span>Provider</span>
            </div>
            {destinations.map(destination => <div key={destination.channelInstanceId} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) 110px minmax(140px, 1fr) 125px 105px', gap: 10, alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--sv-etch)', fontSize: 11 }}>
              <div style={{ minWidth: 0 }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{destination.displayName}</strong><span style={{ color: 'var(--sv-text-dim)' }}>{destination.providerDisplayName}</span></div>
              <strong style={{ color: destination.effectiveDecision === 'include' ? '#166534' : '#64748b' }}>{destination.effectiveDecision === 'include' ? 'Include' : 'Exclude'}</strong>
              <span style={{ overflowWrap: 'anywhere' }}>{destination.matchedRuleName ?? 'Default exclude'}</span>
              <select aria-label={`${destination.displayName} override`} value={destination.overrideMode} disabled={isReadOnly || updatingId === destination.channelInstanceId} onChange={event => void setOverride(destination, event.target.value as OverrideMode)} style={{ width: '100%', height: 29, border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 11 }}>
                <option value="automatic">Automatic</option><option value="include">Include</option><option value="exclude">Exclude</option>
              </select>
              <span style={{ color: destination.providerState === 'error' ? '#991b1b' : 'var(--sv-text-dim)', textTransform: 'capitalize' }}>{destination.providerState.replaceAll('_', ' ')}</span>
            </div>)}
          </div>
        </div>}
  </section>;
}