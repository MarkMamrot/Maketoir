'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, X } from 'lucide-react';
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

type MoveResult = {
  targetOrderId: number;
  targetOrderNumber: string;
};

export function SalesOrderMoveItemsModal({ order, onClose, onMoved }: { order: any; onClose: () => void; onMoved?: (result: MoveResult, createdNew: boolean) => void | Promise<void> }) {
  const [preview, setPreview] = useState<SalesOrderTransferPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [allocatedIncomingQuantities, setAllocatedIncomingQuantities] = useState<Record<number, string>>({});
  const [targetChoice, setTargetChoice] = useState<number | 'new' | null>(null);
  const [sourceClosureAcknowledged, setSourceClosureAcknowledged] = useState(false);
  const operationKey = useRef('');

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
          (payload.data.lines ?? []).map((line: SalesOrderTransferPreviewLine) => [line.itemId, String(line.rules.outstanding)]),
        ));
        setAllocatedIncomingQuantities(Object.fromEntries(
          (payload.data.lines ?? []).map((line: SalesOrderTransferPreviewLine) => [line.itemId, String(line.rules.allocatedIncoming)]),
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
  const willCloseSource = (preview?.lines.length ?? 0) > 0 && preview!.lines.every(
    line => Number(quantities[line.itemId] ?? 0) >= line.rules.outstanding - 0.00005,
  );
  const selectedTarget = typeof targetChoice === 'number'
    ? preview?.eligibleTargets.find(target => target.id === targetChoice) ?? null
    : null;
  const canContinue = !sourceBlocked && selectedLines.length > 0;
  const newTargetStatus = preview?.source.status === 'draft'
    ? 'Draft'
    : preview?.source.status === 'backordered' ? 'Backordered' : 'Confirmed';
  const selectedIncomingQuantity = selectedLines.reduce(
    (sum, line) => sum + Number(allocatedIncomingQuantities[line.itemId] ?? 0),
    0,
  );
  const selectedDestinationIsDraft = targetChoice === 'new'
    ? newTargetStatus === 'Draft'
    : selectedTarget?.status === 'draft';
  const destinationAllocationConflict = selectedDestinationIsDraft && selectedIncomingQuantity > 0;

  function setPreset(line: SalesOrderTransferPreviewLine, preset: QuantityPreset) {
    const nextQuantity = line.rules[preset];
    setQuantities(current => ({ ...current, [line.itemId]: String(nextQuantity) }));
    setAllocatedIncomingQuantities(current => ({
      ...current,
      [line.itemId]: String(Math.min(nextQuantity, line.rules.allocatedIncoming)),
    }));
  }

  function normalizeQuantity(rawValue: string, maximum: number): string {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return '0';
    return String(Math.min(maximum, Math.max(0, value)));
  }

  function commitMoveQuantity(line: SalesOrderTransferPreviewLine) {
    const boundedQuantity = Number(normalizeQuantity(quantities[line.itemId] ?? '', line.rules.outstanding));
    setQuantities(current => ({ ...current, [line.itemId]: String(boundedQuantity) }));
    setAllocatedIncomingQuantities(current => ({
      ...current,
      [line.itemId]: String(Math.min(Number(current[line.itemId] || 0), boundedQuantity, line.rules.allocatedIncoming)),
    }));
  }

  function commitProtectedQuantity(line: SalesOrderTransferPreviewLine) {
    const maximum = Math.min(Number(quantities[line.itemId] || 0), line.rules.allocatedIncoming);
    setAllocatedIncomingQuantities(current => ({
      ...current,
      [line.itemId]: normalizeQuantity(current[line.itemId] ?? '', maximum),
    }));
  }

  async function submitMove() {
    if (!preview || targetChoice == null || submitting || (willCloseSource && !sourceClosureAcknowledged)) return;
    if (!operationKey.current) operationKey.current = crypto.randomUUID();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/sales-orders/${order.id}/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationMode: targetChoice === 'new' ? 'new' : 'existing',
          targetOrderId: selectedTarget?.id ?? null,
          operationKey: operationKey.current,
          expectedSourceUpdatedAt: preview.source.updatedAt,
          expectedTargetUpdatedAt: selectedTarget?.updatedAt ?? null,
          lines: selectedLines.map(line => ({
            sourceItemId: line.itemId,
            quantity: Number(quantities[line.itemId] || 0),
            allocatedIncomingQuantity: Number(allocatedIncomingQuantities[line.itemId] || 0),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Items could not be moved.');
      await onMoved?.(payload.data, targetChoice === 'new');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Items could not be moved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-items-title"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ width: 'min(880px,100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-bg-1,#fff)', color: 'var(--sv-text-strong,#0f172a)', border: '1px solid var(--sv-etch,#cbd5e1)', borderRadius: 8, boxShadow: '0 24px 80px rgba(0,0,0,.35)' }}>
        <header style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--sv-etch,#cbd5e1)', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--sv-mint,#34d399)', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' }}>Move items</div>
            <h2 id="move-items-title" style={{ margin: '5px 0 4px', fontSize: 21 }}>{order.so_number || `SO ${order.id}`}</h2>
            <p style={{ margin: 0, color: 'var(--sv-text-dim,#64748b)', fontSize: 13 }}>Move selected outstanding quantities and choose how much protected incoming supply follows them.</p>
          </div>
          <button type="button" aria-label="Close move items preview" onClick={onClose} style={{ alignSelf: 'flex-start', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderBottom: '1px solid var(--sv-etch,#cbd5e1)', background: 'var(--sv-bg-2,#f8fafc)' }}>
          {['1  Choose quantities', '2  Choose destination', '3  Review'].map((label, index) => (
            <div key={label} style={{ padding: '10px 22px', fontSize: 12, fontWeight: 700, color: step === index + 1 ? 'var(--sv-text-strong,#0f172a)' : 'var(--sv-text-dim,#64748b)', borderBottom: step === index + 1 ? '2px solid var(--sv-action,#0f766e)' : '2px solid transparent' }}>{label}</div>
          ))}
        </div>

        <div style={{ padding: 22 }}>
          {loading && <div aria-live="polite" style={{ color: 'var(--sv-text-dim,#64748b)' }}>Checking order quantities and possible destinations...</div>}
          {error && <div role="alert" style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 6 }}>{error}</div>}

          {preview && !loading && step === 1 && (
            <div style={{ display: 'grid', gap: 14 }}>
              {sourceBlocked && (
                <div role="alert" style={{ padding: 12, border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', borderRadius: 6 }}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 7 }}><AlertTriangle size={16} />This order cannot move items yet</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{preview.source.conflicts.map(reason => <li key={reason}>{reason}</li>)}</ul>
                </div>
              )}
              {preview.lines.length === 0 && <div style={{ color: 'var(--sv-text-dim,#aab4c2)' }}>This Sales Order has no outstanding quantities to move.</div>}
              {preview.lines.map(line => (
                <section key={line.itemId} style={{ border: '1px solid var(--sv-etch,#cbd5e1)', borderRadius: 7, padding: 14 }}>
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
                        style={{ padding: '7px 9px', borderRadius: 5, border: Number(quantities[line.itemId]) === line.rules[preset.value] && line.rules[preset.value] > 0 ? '1px solid var(--sv-action,#0f766e)' : '1px solid var(--sv-etch,#cbd5e1)', background: 'var(--sv-bg-1,#fff)', color: 'var(--sv-text-main,#334155)', cursor: line.rules[preset.value] > 0 && !sourceBlocked ? 'pointer' : 'not-allowed', opacity: line.rules[preset.value] > 0 ? 1 : .45, fontSize: 12 }}
                      >
                        {preset.label} · {formatQuantity(line.rules[preset.value])}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 12, maxWidth: 460 }}>
                    <label style={{ display: 'grid', gridTemplateRows: 'auto 38px auto', gap: 5, minWidth: 0, fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>
                      Quantity to move
                      <input type="number" min={0} max={line.rules.outstanding} step="0.0001" disabled={sourceBlocked} value={quantities[line.itemId] ?? ''} onChange={event => setQuantities(current => ({ ...current, [line.itemId]: event.target.value }))} onBlur={() => commitMoveQuantity(line)} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 9px', borderRadius: 5, border: '1px solid var(--sv-etch,#cbd5e1)', background: 'var(--sv-bg-1,#fff)', color: 'var(--sv-text-strong,#0f172a)' }} />
                      <span aria-hidden="true" />
                    </label>
                    <label style={{ display: 'grid', gridTemplateRows: 'auto 38px auto', gap: 5, minWidth: 0, fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>
                      Protected incoming to move
                      <input type="number" min={0} max={Math.min(Number(quantities[line.itemId] || 0), line.rules.allocatedIncoming)} step="0.0001" disabled={sourceBlocked || Number(quantities[line.itemId] ?? 0) <= 0} value={allocatedIncomingQuantities[line.itemId] ?? ''} onChange={event => setAllocatedIncomingQuantities(current => ({ ...current, [line.itemId]: event.target.value }))} onBlur={() => commitProtectedQuantity(line)} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 9px', borderRadius: 5, border: '1px solid var(--sv-etch,#cbd5e1)', background: 'var(--sv-bg-1,#fff)', color: 'var(--sv-text-strong,#0f172a)' }} />
                      <span>Up to {formatQuantity(Math.min(Number(quantities[line.itemId] || 0), line.rules.allocatedIncoming))} can follow this quantity.</span>
                    </label>
                  </div>
                </section>
              ))}
            </div>
          )}

          {preview && !loading && step === 2 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <section>
                <h3 style={{ margin: '0 0 9px', fontSize: 15 }}>Destination</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: `1px solid ${targetChoice === 'new' ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 6, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="radio" name="move-target" checked={targetChoice === 'new'} onChange={() => setTargetChoice('new')} />
                  <span style={{ flex: 1 }}><strong>Create new Sales Order</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12, marginTop: 3 }}>Same customer, location and commercial terms · starts {newTargetStatus}</span></span>
                  {targetChoice === 'new' && <Check size={16} color="var(--sv-mint,#34d399)" />}
                </label>
                {preview.eligibleTargets.length > 0 && <h3 style={{ margin: '14px 0 9px', fontSize: 15 }}>Existing compatible Sales Orders</h3>}
                {preview.eligibleTargets.map(target => (
                  <label key={target.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11, border: `1px solid ${targetChoice === target.id ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 6, marginBottom: 8, cursor: 'pointer' }}>
                    <input type="radio" name="move-target" checked={targetChoice === target.id} onChange={() => setTargetChoice(target.id)} />
                    <span style={{ flex: 1 }}><strong>{targetLabel(target)}</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12, marginTop: 3 }}>{formatQuantity(target.outstandingQuantity)} already outstanding · {target.status === 'backordered' ? 'Backordered' : target.status.replaceAll('_', ' ')}</span></span>
                    {targetChoice === target.id && <Check size={16} color="var(--sv-mint,#34d399)" />}
                  </label>
                ))}
              </section>
              {preview.excludedTargets.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>{preview.excludedTargets.length} other order(s) cannot receive these items</summary>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{preview.excludedTargets.map(target => <div key={target.id} style={{ padding: 10, borderLeft: '3px solid #f59e0b', background: 'rgba(245,158,11,.07)', fontSize: 12 }}><strong>{target.orderNumber}</strong><div style={{ color: 'var(--sv-text-dim,#aab4c2)', marginTop: 3 }}>{target.conflicts.join(' ')}</div></div>)}</div>
                </details>
              )}
              {targetChoice != null && <div role="status" style={{ padding: 12, background: 'var(--sv-bg-2,#111827)', borderRadius: 6, fontSize: 13 }}><strong>Planned move:</strong> {selectedLines.length} line(s) from {preview.source.orderNumber} to {selectedTarget?.orderNumber ?? `a new ${newTargetStatus} Sales Order`}.</div>}
              {destinationAllocationConflict && <div role="alert" style={{ padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.10)', borderRadius: 6, fontSize: 13 }}>Protected incoming supply cannot follow items to a Draft Sales Order. Go back and set protected incoming to zero, or choose a Confirmed destination.</div>}
            </div>
          )}

          {preview && !loading && step === 3 && targetChoice != null && (
            <div style={{ display: 'grid', gap: 14 }}>
              <section style={{ padding: 14, border: '1px solid var(--sv-border,#364152)', borderRadius: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong>{preview.source.orderNumber}</strong><ArrowRight size={16} /><strong>{selectedTarget?.orderNumber ?? 'New Sales Order'}</strong>
                </div>
                <div style={{ marginTop: 5, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{selectedTarget ? targetLabel(selectedTarget) : `Created as ${newTargetStatus} with the source order's customer, location and commercial terms`}</div>
              </section>
              {selectedLines.map(line => (
                <section key={line.itemId} style={{ padding: 14, borderBottom: '1px solid var(--sv-border,#364152)', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14 }}>
                  <div><strong>{line.productName}</strong>{line.sku && <span style={{ marginLeft: 8, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 12 }}>{line.sku}</span>}</div>
                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                    <strong>{formatQuantity(Number(quantities[line.itemId] || 0))}</strong> to move
                    <div style={{ color: 'var(--sv-text-dim,#aab4c2)', marginTop: 3 }}>{formatQuantity(Number(allocatedIncomingQuantities[line.itemId] || 0))} protected incoming follows</div>
                  </div>
                </section>
              ))}
              <div style={{ padding: 12, background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 6, fontSize: 13 }}>Both Sales Orders will keep their existing fulfilled quantities, freight and discounts. This move does not dispatch stock.</div>
              {willCloseSource && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: 12, border: '1px solid #f59e0b', background: 'rgba(245,158,11,.08)', borderRadius: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={sourceClosureAcknowledged} onChange={event => setSourceClosureAcknowledged(event.target.checked)} />
                  <span><strong>I understand {preview.source.orderNumber} will close</strong><span style={{ display: 'block', color: 'var(--sv-text-dim,#aab4c2)', marginTop: 3 }}>No outstanding quantity will remain on the source Sales Order after this move.</span></span>
                </label>
              )}
            </div>
          )}
        </div>

        <footer style={{ padding: '14px 22px', borderTop: '1px solid var(--sv-etch,#cbd5e1)', display: 'flex', justifyContent: 'space-between', gap: 10, background: 'var(--sv-bg-2,#f8fafc)' }}>
          <button type="button" disabled={submitting} onClick={() => step === 1 ? onClose() : setStep(step === 3 ? 2 : 1)} style={{ padding: '9px 13px', borderRadius: 5, border: '1px solid var(--sv-border,#364152)', background: 'transparent', color: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer' }}>{step === 1 ? 'Cancel' : 'Back'}</button>
          {step === 1 ? (
            <button type="button" disabled={!canContinue} onClick={() => setStep(2)} style={{ padding: '9px 13px', borderRadius: 5, border: 0, background: 'var(--sv-action,#0f766e)', color: '#fff', fontWeight: 800, cursor: canContinue ? 'pointer' : 'not-allowed', opacity: canContinue ? 1 : .5, display: 'inline-flex', alignItems: 'center', gap: 7 }}>Choose destination <ArrowRight size={15} /></button>
          ) : step === 2 ? (
            <button type="button" disabled={targetChoice == null || destinationAllocationConflict} onClick={() => setStep(3)} style={{ padding: '9px 13px', borderRadius: 5, border: 0, background: 'var(--sv-action,#0f766e)', color: '#fff', fontWeight: 800, cursor: targetChoice != null && !destinationAllocationConflict ? 'pointer' : 'not-allowed', opacity: targetChoice != null && !destinationAllocationConflict ? 1 : .5, display: 'inline-flex', alignItems: 'center', gap: 7 }}>Review move <ArrowRight size={15} /></button>
          ) : (
            <button type="button" disabled={submitting || (willCloseSource && !sourceClosureAcknowledged)} onClick={submitMove} style={{ padding: '9px 13px', borderRadius: 5, border: 0, background: 'var(--sv-action,#0f766e)', color: '#fff', fontWeight: 800, cursor: submitting || (willCloseSource && !sourceClosureAcknowledged) ? 'not-allowed' : 'pointer', opacity: submitting || (willCloseSource && !sourceClosureAcknowledged) ? .6 : 1, display: 'inline-flex', alignItems: 'center', gap: 7 }}>{submitting && <Loader2 size={15} className="spin" />} {submitting ? 'Moving items...' : 'Move selected items'}</button>
          )}
        </footer>
      </div>
    </div>
  );
}