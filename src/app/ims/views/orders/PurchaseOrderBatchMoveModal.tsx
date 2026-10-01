'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
import type { PurchaseOrderTransferPreview } from '@/lib/ims/orderTransfers/purchaseOrderPreview';

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(Number(value || 0));
}

export function PurchaseOrderBatchMoveModal({ orders, onClose, onMoved }: {
  orders: any[];
  onClose: () => void;
  onMoved?: () => void;
}) {
  const [previews, setPreviews] = useState<Record<number, PurchaseOrderTransferPreview>>({});
  const [selectedAllocations, setSelectedAllocations] = useState<Set<number>>(new Set());
  const [targetOrderId, setTargetOrderId] = useState<number | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const operationKey = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(orders.map(async order => {
      const response = await fetch(`/api/ims/purchase-orders/${order.id}/transfers/preview`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Move preview for ${order.po_number || order.id} could not be loaded.`);
      return payload.data as PurchaseOrderTransferPreview;
    })).then(results => setPreviews(Object.fromEntries(results.map(preview => [preview.source.id, preview]))))
      .catch(cause => { if (cause?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Move previews could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [orders]);

  const selectedIds = useMemo(() => new Set(orders.map(order => Number(order.id))), [orders]);
  const options = useMemo(() => orders.map(order => {
    const orderId = Number(order.id);
    const sourcePreviews = Object.values(previews).filter(preview => preview.source.id !== orderId && selectedIds.has(preview.source.id));
    const conflicts = sourcePreviews.flatMap(preview => {
      if (preview.source.conflicts.length) return preview.source.conflicts.map(reason => `${preview.source.orderNumber}: ${reason}`);
      const excluded = preview.excludedTargets.find(target => target.id === orderId);
      return preview.eligibleTargets.some(target => target.id === orderId)
        ? []
        : excluded?.conflicts.map(reason => `${preview.source.orderNumber}: ${reason}`) ?? [`${preview.source.orderNumber}: destination is not available.`];
    });
    const hasPromises = sourcePreviews.some(preview => preview.lines.some(line => line.allocations.length > 0));
    if (String(order.status) === 'draft' && hasPromises) conflicts.push('Customer promises cannot move to a Draft Purchase Order.');
    return { order, orderId, conflicts };
  }), [orders, previews, selectedIds]);
  const selectedTarget = options.find(option => option.orderId === targetOrderId) ?? null;
  const sourcePreviews = targetOrderId == null ? [] : Object.values(previews)
    .filter(preview => preview.source.id !== targetOrderId && selectedIds.has(preview.source.id));
  const requiredAllocations = sourcePreviews.flatMap(preview => preview.lines.flatMap(line => line.allocations));
  const promisesComplete = requiredAllocations.every(allocation => selectedAllocations.has(allocation.allocationId));
  const sourcesMovable = sourcePreviews.length === Math.max(0, orders.length - 1)
    && sourcePreviews.every(preview => preview.source.conflicts.length === 0 && preview.lines.length > 0);

  async function submit() {
    if (!selectedTarget || !sourcesMovable || !promisesComplete || !acknowledged || submitting) return;
    if (!operationKey.current) operationKey.current = crypto.randomUUID();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/ims/purchase-orders/transfers/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetOrderId: selectedTarget.orderId,
          expectedTargetUpdatedAt: previews[selectedTarget.orderId]?.source.updatedAt ?? null,
          operationKey: operationKey.current,
          sources: sourcePreviews.map(preview => ({
            sourceOrderId: preview.source.id,
            expectedSourceUpdatedAt: preview.source.updatedAt,
            lines: preview.lines.map(line => ({
              sourceItemId: line.itemId,
              quantity: line.outstandingQuantity,
              allocations: line.allocations.filter(allocation => selectedAllocations.has(allocation.allocationId)).map(allocation => ({
                allocationId: allocation.allocationId,
                revision: allocation.revision,
                quantity: allocation.movableQuantity,
              })),
            })),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Purchase Orders could not be combined.');
      onMoved?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Purchase Orders could not be combined.');
    } finally {
      setSubmitting(false);
    }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="po-batch-title" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div style={{ width: 'min(920px,100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-surface,#18202b)', color: 'var(--sv-text,#fff)', border: '1px solid var(--sv-border,#364152)', borderRadius: 8 }}>
      <header style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><div style={{ color: 'var(--sv-mint,#34d399)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Move into one order</div><h2 id="po-batch-title" style={{ margin: '5px 0 4px', fontSize: 21 }}>Combine {orders.length} Purchase Orders</h2><p style={{ margin: 0, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>Choose the PO to keep, then explicitly choose every customer promise that follows its outstanding supply.</p></div><button type="button" aria-label="Close Purchase Order batch move" onClick={onClose} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}><X size={20} /></button></header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderBottom: '1px solid var(--sv-border,#364152)' }}>{['1  Choose destination', '2  Customer promises', '3  Confirm'].map((label, index) => <div key={label} style={{ padding: '10px 22px', fontSize: 12, fontWeight: 700, color: step === index + 1 ? 'inherit' : 'var(--sv-text-dim,#aab4c2)', borderBottom: step === index + 1 ? '2px solid var(--sv-mint,#34d399)' : '2px solid transparent' }}>{label}</div>)}</div>
      <div style={{ padding: 22 }}>
        {loading && <div>Checking selected Purchase Orders...</div>}
        {error && <div role="alert" style={{ padding: 12, border: '1px solid #ef4444', color: '#fca5a5', borderRadius: 6 }}>{error}</div>}
        {!loading && step === 1 && <div style={{ display: 'grid', gap: 10 }}>{options.map(option => <label key={option.orderId} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, border: `1px solid ${targetOrderId === option.orderId ? 'var(--sv-mint,#34d399)' : option.conflicts.length ? '#f59e0b' : 'var(--sv-border,#364152)'}`, borderRadius: 6, opacity: option.conflicts.length ? .72 : 1 }}><input type="radio" name="po-batch-target" disabled={option.conflicts.length > 0} checked={targetOrderId === option.orderId} onChange={() => { setTargetOrderId(option.orderId); setSelectedAllocations(new Set()); setAcknowledged(false); }} /><span style={{ flex: 1 }}><strong>{option.order.po_number}</strong><span style={{ display: 'block', fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>{option.order.supplier_name || 'No supplier'} · {option.order.location_name || 'No location'} · {option.order.status === 'backordered' ? 'Backordered' : String(option.order.status).replaceAll('_', ' ')}</span>{option.conflicts.length > 0 && <span style={{ display: 'block', color: '#fbbf24', fontSize: 12, marginTop: 4 }}>{option.conflicts.join(' ')}</span>}</span>{targetOrderId === option.orderId && <Check size={16} />}</label>)}{options.every(option => option.conflicts.length > 0) && <div role="alert" style={{ display: 'flex', gap: 8, padding: 12, border: '1px solid #f59e0b', borderRadius: 6 }}><AlertTriangle size={17} />No selected Purchase Order can receive every source.</div>}</div>}
        {!loading && step === 2 && selectedTarget && <div style={{ display: 'grid', gap: 14 }}><div role="status" style={{ padding: 12, background: 'var(--sv-bg-2,#111827)', borderRadius: 6 }}><strong>{selectedTarget.order.po_number}</strong> will remain as the destination.</div>{sourcePreviews.map(preview => <section key={preview.source.id} style={{ border: '1px solid var(--sv-border,#364152)', borderRadius: 7, overflow: 'hidden' }}><div style={{ padding: 11, background: 'var(--sv-bg-2,#111827)' }}><strong>{preview.source.orderNumber}</strong> · all outstanding supply moves</div>{preview.lines.map(line => <div key={line.itemId} style={{ padding: 12, borderTop: '1px solid var(--sv-border,#364152)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{line.productName}{line.sku ? ` · ${line.sku}` : ''}</strong><span>{formatQuantity(line.outstandingQuantity)} moves · {formatQuantity(line.receivedQuantity)} received stays</span></div>{line.allocations.map(allocation => <label key={allocation.allocationId} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 10, padding: 9, background: 'var(--sv-bg-2,#111827)', borderRadius: 5 }}><input type="checkbox" checked={selectedAllocations.has(allocation.allocationId)} onChange={event => setSelectedAllocations(current => { const next = new Set(current); if (event.target.checked) next.add(allocation.allocationId); else next.delete(allocation.allocationId); return next; })} /><span><strong>{allocation.salesOrderNumber}</strong> · {allocation.customerName || 'Customer'}<span style={{ display: 'block', fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>{formatQuantity(allocation.movableQuantity)} customer-promised follows</span></span></label>)}</div>)}</section>)}{!promisesComplete && <div role="alert" style={{ color: '#fbbf24', fontSize: 12 }}>Choose every named customer promise before moving all outstanding supply.</div>}</div>}
        {!loading && step === 3 && selectedTarget && <div style={{ display: 'grid', gap: 14 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 14, border: '1px solid var(--sv-border,#364152)', borderRadius: 7 }}><strong>{sourcePreviews.map(preview => preview.source.orderNumber).join(', ')}</strong><ArrowRight size={16} /><strong>{selectedTarget.order.po_number}</strong></div><div style={{ padding: 12, background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 6 }}>Outstanding supply and every named customer promise move in one transaction. Received quantities and stock on hand stay on their source POs.</div><label style={{ display: 'flex', gap: 9, padding: 12, border: '1px solid #f59e0b', borderRadius: 6 }}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span><strong>I understand the source Purchase Orders will close</strong><span style={{ display: 'block', fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>Partially received sources become Complete; wholly unreceived sources become Cancelled.</span></span></label></div>}
      </div>
      <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between' }}><button type="button" disabled={submitting} onClick={() => step === 1 ? onClose() : setStep(step === 3 ? 2 : 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step === 1 ? <button type="button" disabled={targetOrderId == null} onClick={() => setStep(2)}>Review promises <ArrowRight size={15} /></button> : step === 2 ? <button type="button" disabled={!sourcesMovable || !promisesComplete} onClick={() => setStep(3)}>Review move <ArrowRight size={15} /></button> : <button type="button" disabled={submitting || !acknowledged} onClick={submit}>{submitting && <Loader2 size={15} className="spin" />} {submitting ? 'Moving orders...' : 'Move into one order'}</button>}</footer>
    </div>
  </div>;
}
