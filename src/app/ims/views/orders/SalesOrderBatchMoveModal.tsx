'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
import type {
  SalesOrderTransferPreview,
  SalesOrderTransferPreviewLine,
} from '@/lib/ims/orderTransfers/salesOrderPreview';

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(Number(value || 0));
}

function quantityKey(sourceOrderId: number, itemId: number): string {
  return `${sourceOrderId}:${itemId}`;
}

export function SalesOrderBatchMoveModal({
  orders,
  onClose,
  onMoved,
}: {
  orders: any[];
  onClose: () => void;
  onMoved?: () => void;
}) {
  const [previews, setPreviews] = useState<Record<number, SalesOrderTransferPreview>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [targetOrderId, setTargetOrderId] = useState<number | null>(null);
  const [protectedQuantities, setProtectedQuantities] = useState<Record<string, number>>({});
  const [sourceClosureAcknowledged, setSourceClosureAcknowledged] = useState(false);
  const operationKey = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all(orders.map(async order => {
      const response = await fetch(`/api/ims/sales-orders/${order.id}/transfers/preview`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Move preview for ${order.so_number || order.id} could not be loaded.`);
      return payload.data as SalesOrderTransferPreview;
    }))
      .then(nextPreviews => {
        const byId = Object.fromEntries(nextPreviews.map(preview => [preview.source.id, preview]));
        setPreviews(byId);
        setProtectedQuantities(Object.fromEntries(nextPreviews.flatMap(preview => preview.lines.map(line => [
          quantityKey(preview.source.id, line.itemId),
          line.rules.allocatedIncoming,
        ]))));
      })
      .catch(cause => {
        if (cause?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Move previews could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orders]);

  const selectedIds = useMemo(() => new Set(orders.map(order => Number(order.id))), [orders]);
  const destinationOptions = useMemo(() => orders.map(order => {
    const orderId = Number(order.id);
    const conflicts = orders
      .filter(candidate => Number(candidate.id) !== orderId)
      .flatMap(candidate => {
        const preview = previews[Number(candidate.id)];
        if (!preview) return [];
        if (preview.source.conflicts.length > 0) {
          return preview.source.conflicts.map(reason => `${preview.source.orderNumber}: ${reason}`);
        }
        const eligible = preview.eligibleTargets.some(target => target.id === orderId);
        if (eligible) return [];
        const excluded = preview.excludedTargets.find(target => target.id === orderId);
        return excluded?.conflicts.map(reason => `${preview.source.orderNumber}: ${reason}`)
          ?? [`${preview.source.orderNumber}: destination is not available.`];
      });
    return { order, orderId, conflicts };
  }), [orders, previews]);
  const selectedTarget = destinationOptions.find(option => option.orderId === targetOrderId) ?? null;
  const sourcePreviews = targetOrderId == null
    ? []
    : Object.values(previews).filter(preview => preview.source.id !== targetOrderId && selectedIds.has(preview.source.id));
  const allSourcesMovable = sourcePreviews.length === Math.max(0, orders.length - 1)
    && sourcePreviews.every(preview => preview.source.conflicts.length === 0 && preview.lines.length > 0);

  function setProtectedQuantity(sourceOrderId: number, line: SalesOrderTransferPreviewLine, nextValue: number) {
    const bounded = Math.min(line.rules.outstanding, line.rules.allocatedIncoming, Math.max(0, nextValue || 0));
    setProtectedQuantities(current => ({ ...current, [quantityKey(sourceOrderId, line.itemId)]: bounded }));
  }

  async function submitMove() {
    if (targetOrderId == null || !selectedTarget || !allSourcesMovable || !sourceClosureAcknowledged || submitting) return;
    if (!operationKey.current) operationKey.current = crypto.randomUUID();
    setSubmitting(true);
    setError('');
    try {
      const targetPreview = previews[targetOrderId];
      const response = await fetch('/api/ims/sales-orders/transfers/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetOrderId,
          expectedTargetUpdatedAt: targetPreview?.source.updatedAt ?? null,
          operationKey: operationKey.current,
          sources: sourcePreviews.map(preview => ({
            sourceOrderId: preview.source.id,
            expectedSourceUpdatedAt: preview.source.updatedAt,
            lines: preview.lines.map(line => ({
              sourceItemId: line.itemId,
              quantity: line.rules.outstanding,
              allocatedIncomingQuantity: protectedQuantities[quantityKey(preview.source.id, line.itemId)] ?? 0,
            })),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Orders could not be combined.');
      onMoved?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Orders could not be combined.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="batch-move-title" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={{ width: 'min(920px,100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-surface,#18202b)', color: 'var(--sv-text,#fff)', border: '1px solid var(--sv-border,#364152)', borderRadius: 8, boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
        <header style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--sv-mint,#34d399)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Move into one order</div>
            <h2 id="batch-move-title" style={{ margin: '5px 0 4px', fontSize: 21 }}>Combine {orders.length} Sales Orders</h2>
            <p style={{ margin: 0, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>Choose the order to keep, then review all outstanding quantities and protected incoming supply.</p>
          </div>
          <button type="button" aria-label="Close move into one order" onClick={onClose} style={{ alignSelf: 'flex-start', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderBottom: '1px solid var(--sv-border,#364152)' }}>
          {['1  Choose destination', '2  Review quantities', '3  Confirm'].map((label, index) => <div key={label} style={{ padding: '10px 22px', fontSize: 12, fontWeight: 700, color: step === index + 1 ? 'var(--sv-text,#fff)' : 'var(--sv-text-dim,#aab4c2)', borderBottom: step === index + 1 ? '2px solid var(--sv-mint,#34d399)' : '2px solid transparent' }}>{label}</div>)}
        </div>

        <div style={{ padding: 22 }}>
          {loading && <div aria-live="polite" style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>Checking selected orders and quantities...</div>}
          {error && <div role="alert" style={{ padding: 12, border: '1px solid #ef4444', background: 'rgba(239,68,68,.10)', color: '#fca5a5', borderRadius: 6 }}>{error}</div>}

          {!loading && Object.keys(previews).length > 0 && step === 1 && (
            <div style={{ display: 'grid', gap: 10 }}>
              {destinationOptions.map(option => {
                const disabled = option.conflicts.length > 0;
                return <label key={option.orderId} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, border: `1px solid ${targetOrderId === option.orderId ? 'var(--sv-mint,#34d399)' : disabled ? 'rgba(245,158,11,.45)' : 'var(--sv-border,#364152)'}`, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .72 : 1 }}>
                  <input type="radio" name="batch-target" checked={targetOrderId === option.orderId} disabled={disabled} onChange={() => { setTargetOrderId(option.orderId); setSourceClosureAcknowledged(false); }} />
                  <span style={{ flex: 1 }}><strong>{option.order.so_number || `SO ${option.orderId}`}</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12, marginTop: 3 }}>{option.order.customer_name || 'No customer'} · {option.order.location_name || 'No location'} · {option.order.status === 'backordered' ? 'Backordered' : String(option.order.status).replaceAll('_', ' ')}</span>{disabled && <span style={{ display: 'block', color: '#fbbf24', fontSize: 12, marginTop: 5 }}>{option.conflicts.join(' ')}</span>}</span>
                  {targetOrderId === option.orderId && <Check size={16} color="var(--sv-mint,#34d399)" />}
                </label>;
              })}
              {destinationOptions.every(option => option.conflicts.length > 0) && <div role="alert" style={{ display: 'flex', gap: 8, padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.10)', borderRadius: 6 }}><AlertTriangle size={17} /><span>No selected order can receive every other order. Review the reasons above and select a compatible set.</span></div>}
            </div>
          )}

          {!loading && step === 2 && selectedTarget && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div role="status" style={{ padding: 12, background: 'var(--sv-bg-2,#111827)', borderRadius: 6 }}><strong>{selectedTarget.order.so_number}</strong> will remain open as the destination.</div>
              {sourcePreviews.map(preview => <section key={preview.source.id} style={{ border: '1px solid var(--sv-border,#364152)', borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', background: 'var(--sv-bg-2,#111827)', display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{preview.source.orderNumber}</strong><span style={{ color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>All outstanding moves</span></div>
                {preview.lines.map(line => <div key={line.itemId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(180px,220px)', alignItems: 'end', gap: 14, padding: 12, borderTop: '1px solid var(--sv-border,#364152)' }}>
                  <div><strong>{line.productName}</strong>{line.sku && <span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{line.sku}</span>}</div>
                  <div style={{ fontSize: 13, textAlign: 'right' }}><strong>{formatQuantity(line.rules.outstanding)}</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 11 }}>to move</span></div>
                  <label style={{ display: 'grid', gap: 4, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 11 }}>Protected incoming to move<input type="number" min={0} max={Math.min(line.rules.outstanding, line.rules.allocatedIncoming)} step="0.0001" aria-label={`Protected incoming from ${preview.source.orderNumber} for ${line.productName}`} value={protectedQuantities[quantityKey(preview.source.id, line.itemId)] ?? 0} onChange={event => setProtectedQuantity(preview.source.id, line, Number(event.target.value))} style={{ padding: '8px 9px', borderRadius: 5, border: '1px solid var(--sv-border,#364152)', background: 'var(--sv-bg-2,#111827)', color: 'inherit' }} /></label>
                </div>)}
              </section>)}
            </div>
          )}

          {!loading && step === 3 && selectedTarget && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14, border: '1px solid var(--sv-border,#364152)', borderRadius: 7 }}><strong>{sourcePreviews.map(preview => preview.source.orderNumber).join(', ')}</strong><ArrowRight size={16} /><strong>{selectedTarget.order.so_number}</strong></div>
              <div style={{ padding: 12, background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 6, fontSize: 13 }}>All outstanding quantities move in one transaction. Fulfilled quantities remain on their source orders, and this does not dispatch stock.</div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.08)', borderRadius: 6, fontSize: 13 }}><input type="checkbox" checked={sourceClosureAcknowledged} onChange={event => setSourceClosureAcknowledged(event.target.checked)} /><span><strong>I understand the source Sales Orders will close</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', marginTop: 3 }}>Each source will become Fulfilled if it has prior fulfilments, otherwise Cancelled.</span></span></label>
            </div>
          )}
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <button type="button" disabled={submitting} onClick={() => step === 1 ? onClose() : setStep(step === 3 ? 2 : 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>
          {step === 1 ? <button type="button" disabled={targetOrderId == null} onClick={() => setStep(2)}>Review quantities <ArrowRight size={15} /></button> : step === 2 ? <button type="button" disabled={!allSourcesMovable} onClick={() => setStep(3)}>Review move <ArrowRight size={15} /></button> : <button type="button" disabled={submitting || !sourceClosureAcknowledged} onClick={submitMove}>{submitting && <Loader2 size={15} className="spin" />} {submitting ? 'Moving orders...' : 'Move into one order'}</button>}
        </footer>
      </div>
    </div>
  );
}
