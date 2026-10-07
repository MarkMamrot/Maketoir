'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

export function LaybyFeeSettings({ locations }: { locations: { id: number; name: string }[] }) {
  const [locationId, setLocationId] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [percent, setPercent] = useState('0');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (!locationId && locations.length) setLocationId(String(locations[0].id)); }, [locations, locationId]);
  useEffect(() => {
    if (!locationId) return;
    let current = true;
    setSettings(null);
    setMessage('');
    fetch(`/api/pos/settings/location?location_id=${locationId}`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load branch settings.');
      if (current) { setSettings(data.settings); setPercent(String(data.settings.laybyCancellationFeePercent ?? 0)); }
    }).catch(error => { if (current) setMessage(error.message); });
    return () => { current = false; };
  }, [locationId]);
  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/pos/settings/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, location_id: Number(locationId), laybyCancellationFeePercent: Number(percent) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the fee.');
      setMessage('Saved');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the fee.'); }
    finally { setSaving(false); }
  }
  return <section style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--sv-etch)' }}>
    <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>Layby Cancellation Fee</h4>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
      <label>Branch<select aria-label='Layby fee branch' value={locationId} onChange={event => setLocationId(event.target.value)} style={{ display: 'block', padding: 8, border: '1px solid var(--sv-etch)', borderRadius: 4 }}>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label>Fee %<input aria-label='Layby cancellation fee percentage' type='number' min='0' max='100' step='0.01' value={percent} onChange={event => setPercent(event.target.value)} style={{ display: 'block', padding: 8, width: 100, border: '1px solid var(--sv-etch)', borderRadius: 4 }} /></label>
      <button type='button' onClick={save} disabled={!settings || saving || !Number.isFinite(Number(percent)) || Number(percent) < 0 || Number(percent) > 100} style={{ padding: 8, border: '1px solid var(--sv-etch)', borderRadius: 4, display: 'flex', gap: 6, alignItems: 'center' }}><Save size={16} />{saving ? 'Saving...' : 'Save'}</button>
    </div>
    {message && <p role='status' style={{ fontSize: 12 }}>{message}</p>}
  </section>;
}