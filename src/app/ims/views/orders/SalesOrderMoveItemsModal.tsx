'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import type {
  SalesOrderTransferPreview,
  SalesOrderTransferPreviewLine,
  SalesOrderTransferTarget,
} from '@/lib/ims/orderTransfers/salesOrderPreview';

type QuantityPreset = 'outstanding' | 'unavailableNow' | 'readyNow' | 'allocatedIncoming' | 'unallocatedShortage';

const PRESETS: Array<{ value: QuantityPreset; label: string }> = [
  { value: 'outstanding', label: 'All outstanding' },
  { value: 'unavailableNow', label: 'Not ready now' },
  { value: 'readyNow', label: 'Ready now' },
  { value: 'allocatedIncoming', label: 'Protected incoming' },
  { value: 'unallocatedShortage', label: 'Unallocated shortage' },
];

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(Number(value || 0));
}

function targetLabel(target: SalesOrderTransferTarget): string {
  return [target.orderNumber, target.customerName, target.locationName].filter(Boolean).join(' · ');
}

export function SalesOrderMoveItemsModal({ order, onClose }: { order: any; onClose: () => void }) {
  const [preview, setPreview] = useState<SalesOrderTransferPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [targetId, setTargetId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/ims/sales-orders/${order.id}/transfers/preview`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Move preview could not be loaded.');
        setPreview(payload.data);
        setQuantities(Object.fromEntries(
          (payload.data.lines ?? []).map((line: SalesOrderTransferPreviewLine) => [line.itemId, line.rules.outstanding]),
        ));
      })
      .catch(cause => {
        if (cause?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Move preview could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [order.id]);

  const sourceBlocked = (preview?.source.conflicts.length ?? 0) > 0;
  const selectedLines = (preview?.lines ?? []).filter(line => Number(quantities[line.itemId] ?? 0) > 0);
  const selectedTarget = preview?.eligibleTargets.find(target => target.id === targetId) ?? null;
  const canContinue = !sourceBlocked && selectedLines.length > 0 && preview!.eligibleTargets.length > 0;

  function setPreset(line: SalesOrderTransferPreviewLine, preset: QuantityPreset) {
    setQuantities(current => ({ ...current, [line.itemId]: line.rules[preset] }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-items-title"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ width: 'min(880px,100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-surface,#18202b)', color: 'var(--sv-text,#fff)', border: '1px solid var(--sv-border,#364152)', borderRadius: 8, boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
        <header style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--sv-mint,#34d399)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Move items · Preview only</div>
            <h2 id="move-items-title" style={{ margin: '5px 0 4px', fontSize: 21 }}>{order.so_number || `SO ${order.id}`}</h2>
            <p style={{ margin: 0, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>Plan which outstanding quantities would move to another Sales Order. Nothing is changed from this preview.</p>
          </div>
          <button type="button" aria-label="Close move items preview" onClick={onClose} style={{ alignSelf: 'flex-start', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', borderBottom: '1px solid var(--sv-border,#364152)' }}>
          {['1  Choose quantities', '2  Choose destination'].map((label, index) => (
            <div key={label} style={{ padding: '10px 22px', fontSize: 12, fontWeight: 700, color: step === index + 1 ? 'var(--sv-text,#fff)' : 'var(--sv-text-dim,#aab4c2)', borderBottom: step === index + 1 ? '2px solid var(--sv-mint,#34d399)' : '2px solid transparent' }}>{label}</div>
          ))}
        </div>

        <div style={{ padding: 22 }}>
          {loading && <div aria-live="polite" style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>Checking order quantities and possible destinations...</div>}
          {error && <div role="alert" style={{ padding: 12, border: '1px solid #ef4444', background: 'rgba(239,68,68,.10)', color: '#fca5a5', borderRadius: 6 }}>{error}</div>}

          {preview && !loading && step === 1 && (
            <div style={{ display: 'grid', gap: 14 }}>
              {sourceBlocked && (
                <div role="alert" style={{ padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.10)', borderRadius: 6 }}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 7 }}><AlertTriangle size={16} />This order cannot move items yet</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{preview.source.conflicts.map(reason => <li key={reason}>{reason}</li>)}</ul>
                </div>
              )}
              {preview.lines.length === 0 && <div style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>This Sales Order has no outstanding quantities to move.</div>}
              {preview.lines.map(line => (
                <section key={line.itemId} style={{ border: '1px solid var(--sv-border,#364152)', borderRadius: 7, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div><strong>{line.productName}</strong>{line.sku && <span style={{ marginLeft: 8, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{line.sku}</span>}</div>
                    <div style={{ color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{formatQuantity(line.rules.outstanding)} outstanding</div>
                  </div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                    {PRESETS.map(preset => (
                      <button
                        key={preset.value}
                        type="button"
                        disabled={line.rules[preset.value] <= 0 || sourceBlocked}
                        onClick={() => setPreset(line, preset.value)}
                        style={{ padding: '7px 9px', borderRadius: 5, border: quantities[line.itemId] === line.rules[preset.value] && line.rules[preset.value] > 0 ? '1px solid var(--sv-mint,#34d399)' : '1px solid var(--sv-border,#364152)', background: 'var(--sv-bg-2,#111827)', color: 'inherit', cursor: line.rules[preset.value] > 0 && !sourceBlocked ? 'pointer' : 'not-allowed', opacity: line.rules[preset.value] > 0 ? 1 : .45, fontSize: 12 }}
                      >
                        {preset.label} · {formatQuantity(line.rules[preset.value])}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: 'grid', gap: 5, width: 180, marginTop: 12, fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>
                    Quantity to move
                    <input type="number" min={0} max={line.rules.outstanding} step="0.0001" disabled={sourceBlocked} value={quantities[line.itemId] ?? 0} onChange={event => setQuantities(current => ({ ...current, [line.itemId]: Math.min(line.rules.outstanding, Math.max(0, Number(event.target.value) || 0)) }))} style={{ padding: '8px 9px', borderRadius: 5, border: '1px solid var(--sv-border,#364152)', background: 'var(--sv-bg-2,#111827)', color: 'inherit' }} />
                  </label>
                </section>
              ))}
            </div>
          )}

          {preview && !loading && step === 2 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <section>
                <h3 style={{ margin: '0 0 9px', fontSize: 15 }}>Compatible Sales Orders</h3>
                {preview.eligibleTargets.length === 0 ? <p style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>No compatible destination orders were found.</p> : preview.eligibleTargets.map(target => (
                  <label key={target.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: `1px solid ${targetId === target.id ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 6, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="radio" name="move-target" checked={targetId === target.id} onChange={() => setTargetId(target.id)} />
                    <span style={{ flex: 1 }}><strong>{targetLabel(target)}</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12, marginTop: 3 }}>{formatQuantity(target.outstandingQuantity)} already outstanding · {target.status === 'backordered' ? 'On hold' : target.status.replaceAll('_', ' ')}</span></span>
                    {targetId === target.id && <Check size={16} color="var(--sv-mint,#34d399)" />}
                  </label>
                ))}
              </section>
              {preview.excludedTargets.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>{preview.excludedTargets.length} other order(s) cannot receive these items</summary>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{preview.excludedTargets.map(target => <div key={target.id} style={{ padding: 10, borderLeft: '3px solid #f59e0b', background: 'rgba(245,158,11,.07)', fontSize: 12 }}><strong>{target.orderNumber}</strong><div style={{ color: 'var(--sv-text-dim,#aab4c2)', marginTop: 3 }}>{target.conflicts.join(' ')}</div></div>)}</div>
                </details>
              )}
              {selectedTarget && <div role="status" style={{ padding: 12, background: 'var(--sv-bg-2,#111827)', borderRadius: 6, fontSize: 13 }}><strong>Planned move:</strong> {selectedLines.length} line(s) from {preview.source.orderNumber} to {selectedTarget.orderNumber}. This preview does not change either order.</div>}
            </div>
          )}
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button type="button" onClick={() => step === 1 ? onClose() : setStep(1)} style={{ padding: '9px 13px', borderRadius: 5, border: '1px solid var(--sv-border,#364152)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>{step === 1 ? 'Cancel' : 'Back'}</button>
          {step === 1 ? (
            <button type="button" disabled={!canContinue} onClick={() => setStep(2)} style={{ padding: '9px 13px', borderRadius: 5, border: 0, background: 'var(--sv-mint,#34d399)', color: '#07130f', fontWeight: 800, cursor: canContinue ? 'pointer' : 'not-allowed', opacity: canContinue ? 1 : .5, display: 'inline-flex', alignItems: 'center', gap: 7 }}>Choose destination <ArrowRight size={15} /></button>
          ) : (
            <button type="button" onClick={onClose} style={{ padding: '9px 13px', borderRadius: 5, border: 0, background: 'var(--sv-mint,#34d399)', color: '#07130f', fontWeight: 800, cursor: 'pointer' }}>Close preview</button>
          )}
        </footer>
      </div>
    </div>
  );
}