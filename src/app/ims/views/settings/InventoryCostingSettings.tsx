'use client';

import React, { useCallback, useEffect, useState } from 'react';

type CostMethod = 'average_cost' | 'fifo';

type SwitchPreview = {
  currentMethod: CostMethod;
  targetMethod: CostMethod;
  revision: number;
  stockRowCount: number;
  positiveStockRowCount: number;
  totalQuantity: number;
  totalValue: number;
  blockers: string[];
  warnings: string[];
};

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)',
  background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 13,
};

function methodLabel(method: CostMethod): string {
  return method === 'fifo' ? 'FIFO' : 'Average Cost';
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function InventoryCostingSettings() {
  const [preview, setPreview] = useState<SwitchPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const loadPreview = useCallback(async (targetMethod: CostMethod = 'fifo') => {
    setLoading(true);
    setError('');
    try {
      let payload = await request(`/api/ims/settings/inventory-costing?targetMethod=${targetMethod}`);
      if (payload.preview.currentMethod === targetMethod) {
        const opposite: CostMethod = targetMethod === 'fifo' ? 'average_cost' : 'fifo';
        payload = await request(`/api/ims/settings/inventory-costing?targetMethod=${opposite}`);
      }
      setPreview(payload.preview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Inventory costing could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPreview(); }, [loadPreview]);

  const applySwitch = async () => {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      await request('/api/ims/settings/inventory-costing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMethod: preview.targetMethod,
          expectedRevision: preview.revision,
          operationKey: crypto.randomUUID(),
          reason: reason.trim(),
        }),
      });
      setReason('');
      setConfirmation('');
      await loadPreview(preview.currentMethod);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Inventory costing could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const requiredConfirmation = preview ? methodLabel(preview.targetMethod).toUpperCase() : '';
  const canApply = Boolean(preview)
    && preview!.blockers.length === 0
    && reason.trim().length > 0
    && confirmation.trim().toUpperCase() === requiredConfirmation
    && !saving;

  return (
    <div style={{ padding: 20, background: 'var(--sv-bg-2)', borderRadius: 8, border: '1px solid var(--sv-etch)', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)', textTransform: 'uppercase', letterSpacing: 0 }}>Inventory Costing</h3>
      <p style={{ margin: '0 0 16px', color: 'var(--sv-text-dim)', fontSize: 12.5, lineHeight: 1.55 }}>
        Choose how future stock movements are valued. Existing movement costs and posted Xero journals are preserved.
      </p>

      {loading && <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading costing position...</div>}
      {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      {preview && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Current method</div><strong style={{ color: 'var(--sv-text-strong)', fontSize: 14 }}>{methodLabel(preview.currentMethod)}</strong></div>
            <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Stock quantity</div><strong style={{ color: 'var(--sv-text-strong)', fontSize: 14 }}>{Number(preview.totalQuantity).toLocaleString()}</strong></div>
            <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Opening value</div><strong style={{ color: 'var(--sv-text-strong)', fontSize: 14 }}>{Number(preview.totalValue).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</strong></div>
          </div>

          {preview.blockers.length > 0 && (
            <div style={{ borderLeft: '3px solid var(--sv-red)', paddingLeft: 10, marginBottom: 14 }}>
              {preview.blockers.map(blocker => <div key={blocker} style={{ color: 'var(--sv-red)', fontSize: 12.5, lineHeight: 1.5 }}>{blocker}</div>)}
            </div>
          )}
          {preview.warnings.map(warning => <div key={warning} style={{ color: 'var(--sv-text-dim)', fontSize: 12, lineHeight: 1.5 }}>{warning}</div>)}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sv-etch)' }}>
            <div style={{ color: 'var(--sv-text-strong)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Switch to {methodLabel(preview.targetMethod)}</div>
            <label htmlFor="inventory-costing-reason" style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 12, marginBottom: 5 }}>Reason</label>
            <textarea id="inventory-costing-reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} style={{ ...fieldStyle, minHeight: 70, resize: 'vertical', marginBottom: 10 }} />
            <label htmlFor="inventory-costing-confirmation" style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 12, marginBottom: 5 }}>Type {requiredConfirmation} to confirm</label>
            <input id="inventory-costing-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} style={{ ...fieldStyle, maxWidth: 280, marginBottom: 12 }} />
            <div>
              <button type="button" disabled={!canApply} onClick={applySwitch} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: canApply ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: canApply ? '#fff' : 'var(--sv-text-dim)', cursor: canApply ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700 }}>
                {saving ? 'Switching...' : `Switch to ${methodLabel(preview.targetMethod)}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}