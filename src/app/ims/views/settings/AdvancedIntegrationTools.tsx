'use client';

import { useState } from 'react';

export function AdvancedIntegrationTools({ businessId }: { businessId: string }) {
  const [provider, setProvider] = useState('shopify');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (kind: 'instructions' | 'schema') => {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/ai/build-api-${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: provider, databaseId: businessId }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'API documentation could not be generated.');
      setMessage(kind === 'instructions' ? `Instructions saved (${body.endpoints ?? 0} endpoints).` : `Schema saved (${body.fieldCount ?? 0} fields).`);
    } catch (error) { setError(error instanceof Error ? error.message : 'API documentation could not be generated.'); }
    finally { setBusy(false); }
  };
  return <section>
    <p>SuperAdmin technical tools. Generation is a separate action and can consume AI credits; it does not enable an integration.</p>
    <label>API<select aria-label="API provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="shopify">Shopify</option><option value="meta">Meta</option></select></label>
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}><button type="button" disabled={busy} onClick={() => run('instructions')}>Build API instructions</button><button type="button" disabled={busy} onClick={() => run('schema')}>Generate schema</button></div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
