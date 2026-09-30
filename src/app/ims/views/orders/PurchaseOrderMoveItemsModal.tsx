'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
import type {
  PurchaseOrderTransferPreview,
  PurchaseOrderTransferPreviewLine,
  PurchaseOrderTransferTarget,
} from '@/lib/ims/orderTransfers/purchaseOrderPreview';

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(Number(value || 0));
}

function targetLabel(target: PurchaseOrderTransferTarget): string {
  return [target.orderNumber, target.supplierName, target.locationName].filter(Boolean).join(' · ');
}

export function PurchaseOrderMoveItemsModal({ order, onClose, onMoved }: {
  order: any;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const [preview, setPreview] = useState<PurchaseOrderTransferPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [promiseQuantities, setPromiseQuantities] = useState<Record<number, number>>({});
  const [targetId, setTargetId] = useState<number | null>(null);
  const operationKey = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ims/purchase-orders/${order.id}/transfers/preview`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Move preview could not be loaded.');
        const data = payload.data as PurchaseOrderTransferPreview;
        setPreview(data);
        setQuantities(Object.fromEntries(data.lines.map(line => [line.itemId, line.freeQuantity])));
        setPromiseQuantities(Object.fromEntries(data.lines.flatMap(line => line.allocations.map(allocation => [allocation.allocationId, 0]))));
      })
      .catch(cause => {
        if (cause?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Move preview could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [order.id]);

  const sourceBlocked = (preview?.source.conflicts.length ?? 0) > 0;
  const selectedLines = (preview?.lines ?? []).filter(line => Number(quantities[line.itemId] ?? 0) > 0);
  const selectedTarget = preview?.eligibleTargets.find(target => target.id === targetId) ?? null;
  const selectedPromises = (line: PurchaseOrderTransferPreviewLine) => line.allocations
    .map(allocation => ({ ...allocation, selectedQuantity: Number(promiseQuantities[allocation.allocationId] ?? 0) }))
    .filter(allocation => allocation.selectedQuantity > 0);
  const lineCapacity = (line: PurchaseOrderTransferPreviewLine) => line.freeQuantity
    + selectedPromises(line).reduce((sum, allocation) => sum + allocation.selectedQuantity, 0);
  const invalidLines = selectedLines.filter(line => Number(quantities[line.itemId]) > lineCapacity(line) + 0.00005);
  const canContinue = !sourceBlocked && selectedLines.length > 0 && invalidLines.length === 0 && preview!.eligibleTargets.length > 0;

  function selectFree(line: PurchaseOrderTransferPreviewLine) {
    setQuantities(current => ({ ...current, [line.itemId]: line.freeQuantity }));
    setPromiseQuantities(current => ({ ...current, ...Object.fromEntries(line.allocations.map(allocation => [allocation.allocationId, 0])) }));
  }

  function selectAll(line: PurchaseOrderTransferPreviewLine) {
    setQuantities(current => ({ ...current, [line.itemId]: line.outstandingQuantity }));
    setPromiseQuantities(current => ({ ...current, ...Object.fromEntries(line.allocations.map(allocation => [allocation.allocationId, allocation.movableQuantity])) }));
  }

  async function submitMove() {
    if (!preview || !selectedTarget || submitting) return;
    if (!operationKey.current) operationKey.current = crypto.randomUUID();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/purchase-orders/${order.id}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetOrderId: selectedTarget.id,
          operationKey: operationKey.current,
          expectedSourceUpdatedAt: preview.source.updatedAt,
          expectedTargetUpdatedAt: selectedTarget.updatedAt,
          lines: selectedLines.map(line => ({
            sourceItemId: line.itemId,
            quantity: quantities[line.itemId],
            allocations: selectedPromises(line).map(allocation => ({
              allocationId: allocation.allocationId,
              revision: allocation.revision,
              quantity: allocation.selectedQuantity,
            })),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Items could not be moved.');
      onMoved?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Items could not be moved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="po-move-items-title"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={{ width: 'min(900px,100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-surface,#18202b)', color: 'var(--sv-text,#fff)', border: '1px solid var(--sv-border,#364152)', borderRadius: 8 }}>
        <header style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div><div style={{ color: 'var(--sv-mint,#34d399)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Move PO items</div>
            <h2 id="po-move-items-title" style={{ margin: '5px 0 4px', fontSize: 21 }}>{order.po_number || `PO ${order.id}`}</h2>
            <p style={{ margin: 0, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>Move outstanding supply and choose exactly which customer promises follow.</p></div>
          <button type="button" aria-label="Close move PO items" onClick={onClose} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderBottom: '1px solid var(--sv-border,#364152)' }}>
          {['1  Supply & promises', '2  Destination', '3  Review'].map((label, index) => <div key={label}
            style={{ padding: '10px 22px', fontSize: 12, fontWeight: 700, color: step === index + 1 ? 'var(--sv-text,#fff)' : 'var(--sv-text-dim,#aab4c2)', borderBottom: step === index + 1 ? '2px solid var(--sv-mint,#34d399)' : '2px solid transparent' }}>{label}</div>)}
        </div>
        <div style={{ padding: 22 }}>
          {loading && <div aria-live="polite" style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>Checking outstanding supply and customer promises...</div>}
          {error && <div role="alert" style={{ padding: 12, border: '1px solid #ef4444', background: 'rgba(239,68,68,.10)', color: '#fca5a5', borderRadius: 6 }}>{error}</div>}
          {preview && !loading && step === 1 && <div style={{ display: 'grid', gap: 14 }}>
            {sourceBlocked && <div role="alert" style={{ padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.10)', borderRadius: 6 }}><strong><AlertTriangle size={16} /> This order cannot move items yet</strong><ul>{preview.source.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></div>}
            {preview.lines.map(line => <section key={line.itemId} style={{ border: '1px solid var(--sv-border,#364152)', borderRadius: 7, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{line.productName}{line.sku ? ` · ${line.sku}` : ''}</strong><span>{formatQuantity(line.outstandingQuantity)} outstanding</span></div>
              <div style={{ marginTop: 8, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{formatQuantity(line.freeQuantity)} free · {formatQuantity(line.protectedQuantity)} promised to customers · {formatQuantity(line.receivedQuantity)} already received stays here</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button type="button" onClick={() => selectFree(line)}>Free only</button><button type="button" onClick={() => selectAll(line)}>All outstanding</button></div>
              <label style={{ display: 'grid', gap: 4, width: 190, marginTop: 10, fontSize: 12 }}>Quantity to move
                <input aria-label={`Quantity to move for ${line.productName}`} type="number" min={0} max={line.outstandingQuantity} step="0.0001" value={quantities[line.itemId] ?? 0} onChange={event => setQuantities(current => ({ ...current, [line.itemId]: Math.min(line.outstandingQuantity, Math.max(0, Number(event.target.value) || 0)) }))} /></label>
              {line.allocations.length > 0 && <div style={{ marginTop: 12, display: 'grid', gap: 8 }}><strong style={{ fontSize: 12 }}>Customer promises to move</strong>{line.allocations.map(allocation => <label key={allocation.allocationId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px', alignItems: 'center', gap: 12, fontSize: 12 }}><span><strong>{allocation.salesOrderNumber}</strong> · {allocation.customerName || 'Customer'}<span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)' }}>Up to {formatQuantity(allocation.movableQuantity)} unreceived</span></span><input aria-label={`Promise quantity for ${allocation.salesOrderNumber}`} type="number" min={0} max={allocation.movableQuantity} step="0.0001" value={promiseQuantities[allocation.allocationId] ?? 0} onChange={event => setPromiseQuantities(current => ({ ...current, [allocation.allocationId]: Math.min(allocation.movableQuantity, Math.max(0, Number(event.target.value) || 0)) }))} /></label>)}</div>}
              {Number(quantities[line.itemId] ?? 0) > lineCapacity(line) + 0.00005 && <div role="alert" style={{ color: '#fbbf24', marginTop: 8, fontSize: 12 }}>Select more customer promise quantity or reduce the move to {formatQuantity(lineCapacity(line))}.</div>}
            </section>)}
          </div>}
          {preview && !loading && step === 2 && <div style={{ display: 'grid', gap: 10 }}><h3 style={{ margin: 0, fontSize: 15 }}>Compatible Purchase Orders</h3>{preview.eligibleTargets.map(target => <label key={target.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: `1px solid ${targetId === target.id ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 6 }}><input type="radio" name="po-move-target" checked={targetId === target.id} onChange={() => setTargetId(target.id)} /><span style={{ flex: 1 }}><strong>{targetLabel(target)}</strong><span style={{ display: 'block', fontSize: 12 }}>{formatQuantity(target.outstandingQuantity)} outstanding · {target.status.replaceAll('_', ' ')}</span></span>{targetId === target.id && <Check size={16} />}</label>)}</div>}
          {preview && !loading && step === 3 && selectedTarget && <div style={{ display: 'grid', gap: 12 }}><strong>{preview.source.orderNumber} <ArrowRight size={15} /> {selectedTarget.orderNumber}</strong>{selectedLines.map(line => <div key={line.itemId} style={{ borderBottom: '1px solid var(--sv-border,#364152)', padding: 10 }}><strong>{line.productName}</strong><div>{formatQuantity(quantities[line.itemId])} supply moves · {formatQuantity(selectedPromises(line).reduce((sum, allocation) => sum + allocation.selectedQuantity, 0))} customer-promised</div>{selectedPromises(line).map(allocation => <div key={allocation.allocationId} style={{ fontSize: 12 }}>{allocation.salesOrderNumber}: {formatQuantity(allocation.selectedQuantity)}</div>)}</div>)}<div style={{ padding: 12, background: 'rgba(52,211,153,.08)', borderRadius: 6 }}>Received quantities and stock on hand stay on the source PO. This move does not receive stock.</div></div>}
        </div>
        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--sv-border,#364152)', display: 'flex', justifyContent: 'space-between' }}><button type="button" disabled={submitting} onClick={() => step === 1 ? onClose() : setStep(step === 3 ? 2 : 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step === 1 ? <button type="button" disabled={!canContinue} onClick={() => setStep(2)}>Choose destination <ArrowRight size={15} /></button> : step === 2 ? <button type="button" disabled={!selectedTarget} onClick={() => setStep(3)}>Review move <ArrowRight size={15} /></button> : <button type="button" disabled={submitting} onClick={submitMove}>{submitting && <Loader2 size={15} />} {submitting ? 'Moving items...' : 'Move selected items'}</button>}</footer>
      </div>
    </div>
  );
}
