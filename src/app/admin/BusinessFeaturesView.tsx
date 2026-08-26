'use client';

import { useEffect, useState } from 'react';

type Feature = { key: string; label: string; description: string; product: string };
type Business = { business_id: string; name: string; features: Record<string, boolean> };

export default function BusinessFeaturesView() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const response = await fetch('/api/admin/features', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Feature controls could not be loaded.');
    setFeatures(result.features ?? []);
    setBusinesses(result.businesses ?? []);
  }

  useEffect(() => { void load().catch(caught => setError(caught instanceof Error ? caught.message : 'Feature controls could not be loaded.')); }, []);

  async function toggle(business: Business, feature: Feature) {
    const key = `${business.business_id}:${feature.key}`;
    const enabled = !business.features[feature.key];
    setSaving(key); setError('');
    try {
      const response = await fetch('/api/admin/features', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.business_id, feature_key: feature.key, enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Feature control could not be updated.');
      setBusinesses(current => current.map(item => item.business_id === business.business_id
        ? { ...item, features: { ...item.features, [feature.key]: enabled } }
        : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Feature control could not be updated.');
    } finally { setSaving(''); }
  }

  return <section>
    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Feature Rollouts</h1>
    <p style={{ margin: '5px 0 20px', color: 'var(--sv-text-dim,#94a3b8)', fontSize: 13 }}>Turn developing features on for selected businesses. Changes apply when that business next loads the product.</p>
    {error && <div role="alert" style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid #ef4444', borderRadius: 7, background: 'rgba(239,68,68,.12)', color: '#fca5a5', fontSize: 13 }}>{error}</div>}
    <div style={{ overflowX: 'auto', border: '1px solid var(--sv-etch,rgba(255,255,255,.1))', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
        <thead><tr><th style={th}>Business</th>{features.map(feature => <th style={th} key={feature.key}><strong style={{ display: 'block', color: 'var(--sv-text-main,#e2e8f0)' }}>{feature.label}</strong><span style={{ display: 'block', marginTop: 3, maxWidth: 320, color: 'var(--sv-text-dim,#94a3b8)', fontSize: 10, fontWeight: 400, textTransform: 'none', whiteSpace: 'normal' }}>{feature.description}</span></th>)}</tr></thead>
        <tbody>{businesses.map(business => <tr key={business.business_id}><th scope="row" style={{ ...td, textAlign: 'left' }}><strong>{business.name}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--sv-text-dim,#64748b)', fontFamily: 'monospace' }}>{business.business_id}</small></th>{features.map(feature => {
          const key = `${business.business_id}:${feature.key}`;
          const enabled = Boolean(business.features[feature.key]);
          return <td style={{ ...td, textAlign: 'center' }} key={feature.key}><button type="button" role="switch" aria-checked={enabled} aria-label={`${feature.label} for ${business.name}`} disabled={Boolean(saving)} onClick={() => void toggle(business, feature)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 104, padding: '7px 10px', border: `1px solid ${enabled ? '#22c55e' : 'rgba(255,255,255,.2)'}`, borderRadius: 6, background: enabled ? 'rgba(34,197,94,.14)' : 'rgba(255,255,255,.04)', color: enabled ? '#86efac' : '#94a3b8', cursor: saving ? 'wait' : 'pointer', fontWeight: 700 }}><span aria-hidden="true" style={{ position: 'relative', width: 30, height: 16, borderRadius: 10, background: enabled ? '#22c55e' : '#64748b' }}><i style={{ position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} /></span>{saving === key ? 'Saving' : enabled ? 'On' : 'Off'}</button></td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}

const th: React.CSSProperties = { padding: '10px 14px', borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.1))', background: 'var(--sv-bg-2,#334155)', color: 'var(--sv-text-dim,#94a3b8)', fontSize: 11, textAlign: 'left', textTransform: 'uppercase', verticalAlign: 'top' };
const td: React.CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--sv-etch,rgba(255,255,255,.07))', fontSize: 13 };
