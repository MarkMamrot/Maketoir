'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { buildSalesOrderFulfilmentRequest, type SalesOrderFulfilmentMode } from './salesOrderFulfilmentRequest';

export function SalesOrderFulfilmentModal({
  order,
  items,
  onClose,
  onResolved,
}: {
  order: any;
  items: Array<{ id: number; variant_id?: string; sku?: string; product_name?: string; qty_ordered: number; qty_fulfilled?: number; unit_price?: number; tax_rate?: number; discount_pct?: number }>;
  onClose: () => void;
  onResolved: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<SalesOrderFulfilmentMode>('partial');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const initial: Record<number, string> = {};
    items.forEach(item => {
      const outstanding = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0));
      initial[item.id] = String(outstanding);
    });
    setQuantities(initial);
  }, [items]);

  const summary = useMemo(() => {
    const totalOrdered = items.reduce((sum, item) => sum + Number(item.qty_ordered || 0), 0);
    const totalOutstanding = items.reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0)), 0);
    return { totalOrdered, totalOutstanding };
  }, [items]);

  async function submit(allowNegativeStock = false, operationKey = crypto.randomUUID()) {
    setSaving(true);
    setError('');
    try {
      const payloadItems = items
        .map(item => ({ itemId: item.id, quantity: Number(quantities[item.id] ?? 0) }))
        .filter(item => item.quantity > 0);
      if (payloadItems.length === 0) {
        throw new Error('Enter at least one positive quantity.');
      }
      const request = buildSalesOrderFulfilmentRequest(mode, Number(order.id), payloadItems);
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationKey, allowNegativeStock, ...request.body }),
      });
      const data = await response.json();
      if (response.status === 409 && data?.code === 'STOCK_SHORTFALL' && !allowNegativeStock) {
        const lines = Array.isArray(data.shortfalls) ? data.shortfalls : [];
        const detail = lines.map((line: any) => {
          const item = items.find(candidate => Number(candidate.id) === Number(line.itemId));
          return `${item?.sku || item?.product_name || `Line ${line.itemId}`}: ${line.quantityOnHand} on hand, ${line.requestedQuantity} requested, resulting SOH ${line.resultingQuantityOnHand}`;
        }).join('\n');
        const confirmed = window.confirm(
          `Stock on hand is insufficient:\n\n${detail}\n\n` +
          'Continuing will make stock on hand negative. Stocktake or adjust this stock as soon as possible.\n\n' +
          'Continue and allow negative stock?',
        );
        if (confirmed) return submit(true, operationKey);
        return;
      }
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Fulfilment failed.');
      await onResolved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Fulfilment failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }} onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ width: 'min(760px, 100%)', maxHeight: '92vh', overflow: 'auto', background: 'var(--sv-surface,#18202b)', color: 'var(--sv-text,#fff)', border: '1px solid var(--sv-border,#364152)', borderRadius: 14, padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--sv-mint,#34d399)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em' }}>Fulfil sales order</div>
            <h2 style={{ margin: '5px 0 4px' }}>{order.so_number || order.po_number || 'Sales order'}</h2>
            <p style={{ margin: 0, color: 'var(--sv-text-dim,#aab4c2)', fontSize: 13 }}>
              Choose whether to ship the quantities now and leave the rest open, or split the remainder into a child backorder.
            </p>
          </div>
          <button onClick={onClose} disabled={saving} style={{ background: 'none', border: 0, color: 'inherit', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          <label style={{ display: 'block', padding: 12, border: `1px solid ${mode === 'partial' ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 9, cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'partial'} onChange={() => setMode('partial')} />
            <strong>Partially fulfil now</strong>
            <div style={{ margin: '4px 0 0 22px', fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>
              Ship the quantities entered below now and leave any remaining amount outstanding for a short delay.
            </div>
          </label>
          <label style={{ display: 'block', padding: 12, border: `1px solid ${mode === 'backorder' ? 'var(--sv-mint,#34d399)' : 'var(--sv-border,#364152)'}`, borderRadius: 9, cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'backorder'} onChange={() => setMode('backorder')} />
            <strong>Create backorder for remainder</strong>
            <div style={{ margin: '4px 0 0 22px', fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>
              Fulfil the quantities entered now and move the rest to a held child backorder for later dispatch.
            </div>
          </label>
        </div>

        <div style={{ marginTop: 18, padding: 12, border: '1px solid var(--sv-border,#364152)', borderRadius: 9, background: 'var(--sv-bg-2,#111827)' }}>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)', marginBottom: 8 }}>
            Fulfil {summary.totalOutstanding} of {summary.totalOrdered} outstanding units.
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map(item => {
              const outstanding = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_fulfilled || 0));
              return (
                <div key={item.id} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>{item.sku || item.product_name || `Line ${item.id}`}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>Qty</label>
                    <input type="number" min={0} step={1} value={quantities[item.id] ?? ''} onChange={e => setQuantities(prev => ({ ...prev, [item.id]: e.target.value }))} style={{ width: 90, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--sv-etch,#4b5563)', background: 'var(--sv-bg-1,#0f172a)', color: 'inherit' }} />
                    <span style={{ fontSize: 12, color: 'var(--sv-text-dim,#aab4c2)' }}>of {outstanding}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error ? <div style={{ marginTop: 14, padding: 10, borderRadius: 7, background: 'rgba(248,113,113,.12)', color: '#fecaca', fontSize: 13 }}>{error}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--sv-border,#364152)', color: 'inherit', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--sv-mint,#34d399)', color: '#052e16', fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
