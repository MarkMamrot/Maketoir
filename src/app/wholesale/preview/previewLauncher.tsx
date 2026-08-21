'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Store } from 'lucide-react';

interface Target { memberId: number; contactId: number; companyName: string; locationId: number; locationName: string; isPrimary: boolean; buyerName: string; email: string }

export default function PreviewLauncher() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [supplier, setSupplier] = useState('Wholesale portal');
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch('/api/ims/wholesale/preview').then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Preview could not be loaded.');
      setTargets(body.targets || []); setSupplier(body.supplier?.name || 'Wholesale portal');
      if (body.targets?.[0]) setSelection(`${body.targets[0].memberId}:${body.targets[0].locationId}`);
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Preview could not be loaded.')).finally(() => setLoading(false));
  }, []);

  const start = async () => {
    const [memberId, locationId] = selection.split(':').map(Number);
    if (!memberId || !locationId) return;
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/ims/wholesale/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId, locationId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Preview could not be started.');
      window.location.href = body.nextRoute;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Preview could not be started.'); setStarting(false); }
  };

  return <main style={{ minHeight: '100vh', background: '#f4f6f8', padding: 'clamp(24px,5vw,72px) 20px', color: '#17202a', fontFamily: 'var(--font-sans, sans-serif)' }}>
    <section style={{ maxWidth: 720, margin: '0 auto', background: '#fff', border: '1px solid #d8dee4', borderRadius: 8, boxShadow: '0 12px 32px rgba(23,32,42,.08)' }}>
      <header style={{ padding: '24px 28px', borderBottom: '1px solid #e4e8ec', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', background: '#e8f4f6', color: '#147a8c', borderRadius: 6 }}><Store size={21} /></div>
        <div><h1 style={{ fontSize: 20, margin: 0, letterSpacing: 0 }}>Preview wholesale portal</h1><p style={{ margin: '4px 0 0', color: '#64707d', fontSize: 14 }}>{supplier}</p></div>
      </header>
      <div style={{ padding: 28 }}>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: '#52606d' }}>View the portal as an approved wholesale buyer. Preview access is read-only and expires after five minutes.</p>
        {loading ? <p>Loading approved buyers...</p> : targets.length > 0 ? <>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8 }} htmlFor="preview-target">Buyer and buying location</label>
          <select id="preview-target" value={selection} onChange={event => setSelection(event.target.value)} style={{ width: '100%', padding: '11px 12px', border: '1px solid #aeb8c2', borderRadius: 5, background: '#fff', fontSize: 14 }}>
            {targets.map(target => <option key={`${target.memberId}:${target.locationId}`} value={`${target.memberId}:${target.locationId}`}>{target.companyName} / {target.buyerName} / {target.locationName}{target.isPrimary ? ' (primary)' : ''}</option>)}
          </select>
          <button onClick={start} disabled={starting || !selection} style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', border: 0, borderRadius: 5, background: '#147a8c', color: '#fff', fontWeight: 700, cursor: starting ? 'wait' : 'pointer' }}>{starting ? 'Opening preview...' : 'Open read-only preview'} <ExternalLink size={16} /></button>
        </> : !error && <p>No active approved wholesale buyers with buying locations are available.</p>}
        {error && <p role="alert" style={{ color: '#a12828', background: '#fff1f1', border: '1px solid #f1c4c4', padding: 12, borderRadius: 5 }}>{error}</p>}
      </div>
      <footer style={{ padding: '16px 28px', borderTop: '1px solid #e4e8ec' }}><a href="/ims" style={{ color: '#52606d', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, textDecoration: 'none' }}><ArrowLeft size={16} /> Return to IMS</a></footer>
    </section>
  </main>;
}