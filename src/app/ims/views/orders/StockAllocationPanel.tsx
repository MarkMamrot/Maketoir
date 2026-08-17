'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Link2, Link2Off, RefreshCw } from 'lucide-react';

type Allocation = {
  id: number;
  so_id: number;
  so_item_id: number;
  po_id: number;
  po_item_id: number;
  variant_id: string;
  qty_allocated: number;
  qty_received_assigned: number;
  qty_fulfilled: number;
  source_expected_date: string | null;
  promised_date: string | null;
  promise_status: 'unpromised' | 'confirmed' | 'at_risk';
  state: string;
  revision: number;
  risk_reason?: string | null;
  so_number?: string;
  po_number?: string;
};

type Candidate = {
  poItemId: number;
  poId: number;
  poNumber: string;
  expectedDate: string | null;
  freeQuantity: number;
};

type DemandLine = {
  soItemId: number;
  variantId: string;
  sku: string | null;
  productName: string;
  outstanding: number;
  allocatedIncoming: number;
  unsourced: number;
  candidates: Candidate[];
};

const qty = (value: unknown) => Number(value ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 4 });
const date = (value: string | null | undefined) => value ? value.slice(0, 10) : 'No date';
const operationKey = (action: string, id: number | string) => `${action}-${id}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

export function StockAllocationPanel({
  mode,
  orderId,
  items,
  allocations,
  readOnly = false,
  onChanged,
}: {
  mode: 'sales_order' | 'purchase_order';
  orderId: number;
  items: any[];
  allocations: Allocation[];
  readOnly?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [demand, setDemand] = useState<DemandLine[]>([]);
  const [loading, setLoading] = useState(mode === 'sales_order');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<number, { poItemId: string; quantity: string; promisedDate: string; reason: string }>>({});

  const loadDemand = async () => {
    if (mode !== 'sales_order') return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/stock-allocations?candidatesForSo=${orderId}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load incoming stock options.');
      setDemand(Array.isArray(body.data) ? body.data : []);
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load incoming stock options.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDemand(); }, [mode, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const command = async (method: 'POST' | 'PATCH', body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError('');
    try {
      const response = await fetch('/api/ims/stock-allocations', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Stock allocation update failed.');
      await onChanged();
      await loadDemand();
    } catch (commandError: any) {
      setError(commandError.message || 'Stock allocation update failed.');
    } finally {
      setBusy(null);
    }
  };

  const allocate = async (line: DemandLine) => {
    const draft = drafts[line.soItemId] ?? { poItemId: '', quantity: '', promisedDate: '', reason: '' };
    const selected = line.candidates.find(candidate => String(candidate.poItemId) === draft.poItemId);
    if (!selected) return setError('Select an incoming purchase order drop.');
    const quantity = Number(draft.quantity);
    if (!(quantity > 0) || quantity > Math.min(line.unsourced, selected.freeQuantity)) {
      return setError('Allocation quantity exceeds unsourced demand or free incoming stock.');
    }
    const isFifoOverride = selected.poItemId !== line.candidates[0]?.poItemId;
    if (isFifoOverride && !draft.reason.trim()) return setError('Enter a reason for overriding the first available PO drop.');
    await command('POST', {
      operationKey: operationKey('allocate', line.soItemId),
      soItemId: line.soItemId,
      poItemId: selected.poItemId,
      quantity,
      promisedDate: draft.promisedDate || null,
      priority: 0,
      overrideReason: isFifoOverride ? draft.reason.trim() : null,
    }, `allocate-${line.soItemId}`);
  };

  const release = async (allocation: Allocation) => {
    const reason = window.prompt('Reason for releasing this protected allocation:')?.trim();
    if (!reason) return;
    await command('PATCH', {
      operationKey: operationKey('release', allocation.id), allocationId: allocation.id,
      revision: allocation.revision, action: 'release', reason,
    }, `release-${allocation.id}`);
  };

  const revisePromise = async (allocation: Allocation) => {
    const promisedDate = window.prompt('Confirmed customer promise date (YYYY-MM-DD), or leave blank to remove:', allocation.promised_date?.slice(0, 10) ?? '');
    if (promisedDate == null) return;
    const reason = window.prompt('Reason for confirming or revising this promise:')?.trim();
    if (!reason) return;
    await command('PATCH', {
      operationKey: operationKey('promise', allocation.id), allocationId: allocation.id,
      revision: allocation.revision, action: 'revise_promise', promisedDate: promisedDate.trim() || null, reason,
    }, `promise-${allocation.id}`);
  };

  const reassign = async (allocation: Allocation) => {
    const line = demand.find(entry => entry.soItemId === allocation.so_item_id);
    const incomingRequired = Math.max(0, Number(allocation.qty_allocated) - Number(allocation.qty_received_assigned));
    const alternatives = line?.candidates.filter(candidate => candidate.poItemId !== allocation.po_item_id && candidate.freeQuantity >= incomingRequired) ?? [];
    if (alternatives.length === 0) return setError('No other eligible PO drop has enough free incoming stock.');
    const menu = alternatives.map(candidate => `${candidate.poItemId}: ${candidate.poNumber}, ${qty(candidate.freeQuantity)} free, ETA ${date(candidate.expectedDate)}`).join('\n');
    const selectedId = Number(window.prompt(`Enter the PO line ID to reassign to:\n${menu}`));
    if (!alternatives.some(candidate => candidate.poItemId === selectedId)) return;
    const reason = window.prompt('Reason for reassigning this allocation:')?.trim();
    if (!reason) return;
    await command('PATCH', {
      operationKey: operationKey('reassign', allocation.id), allocationId: allocation.id,
      revision: allocation.revision, action: 'reassign', poItemId: selectedId, reason,
    }, `reassign-${allocation.id}`);
  };

  const active = allocations.filter(allocation => allocation.state === 'active');
  const allocationsForItem = (itemId: number, key: 'so_item_id' | 'po_item_id') => active.filter(allocation => Number(allocation[key]) === Number(itemId));

  return (
    <section style={{ marginTop: 20, borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
        <Link2 size={16} aria-hidden="true" />
        <strong style={{ fontSize: 13, color: 'var(--sv-text-strong)' }}>Incoming stock allocation</strong>
        <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{active.length} active</span>
        {mode === 'sales_order' && <button type="button" onClick={loadDemand} disabled={loading} title="Refresh incoming stock" aria-label="Refresh incoming stock" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 4 }}><RefreshCw size={15} /></button>}
      </div>
      {error && <div role="alert" style={{ marginBottom: 10, padding: '7px 9px', background: 'rgba(248,113,113,.1)', color: '#f87171', fontSize: 12 }}>{error}</div>}
      {mode === 'sales_order' && loading && <div style={{ padding: '0 0 12px', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading availability...</div>}
      {mode === 'sales_order' && !loading && demand.map(line => {
        const lineAllocations = allocationsForItem(line.soItemId, 'so_item_id');
        const draft = drafts[line.soItemId] ?? { poItemId: '', quantity: '', promisedDate: '', reason: '' };
        const selectedIndex = line.candidates.findIndex(candidate => String(candidate.poItemId) === draft.poItemId);
        return <div key={line.soItemId} style={{ padding: '10px 0', borderTop: '1px solid var(--sv-etch)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 12 }}>{line.sku || line.productName}</strong>
            <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Outstanding {qty(line.outstanding)}</span>
            <span style={{ fontSize: 12, color: line.allocatedIncoming > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)' }}>Allocated {qty(line.allocatedIncoming)}</span>
            <span style={{ fontSize: 12, color: line.unsourced > 0 ? 'var(--sv-amber)' : 'var(--sv-text-dim)' }}>Unsourced {qty(line.unsourced)}</span>
          </div>
          {lineAllocations.map(allocation => <div key={allocation.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingTop: 7, fontSize: 12 }}>
            <span>{allocation.po_number}</span><span>{qty(allocation.qty_allocated)} allocated</span>
            <span>{qty(allocation.qty_received_assigned)} received</span><span>ETA {date(allocation.source_expected_date)}</span>
            <span style={{ color: allocation.promise_status === 'at_risk' ? 'var(--sv-amber)' : allocation.promise_status === 'confirmed' ? 'var(--sv-mint)' : 'var(--sv-text-dim)', fontWeight: 700 }}>{allocation.promise_status.replace('_', ' ')}</span>
            {allocation.promised_date && <span>Promise {date(allocation.promised_date)}</span>}
            {!readOnly && <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
              <button type="button" onClick={() => revisePromise(allocation)} disabled={!!busy} title="Confirm or revise promise" style={smallButton}><CalendarClock size={13} /> Promise</button>
              <button type="button" onClick={() => reassign(allocation)} disabled={!!busy} title="Move to another PO drop" style={smallButton}><RefreshCw size={13} /> Reassign</button>
              <button type="button" onClick={() => release(allocation)} disabled={!!busy} title="Release protected allocation" style={smallButton}><Link2Off size={13} /> Release</button>
            </div>}
            {allocation.risk_reason && <div style={{ flexBasis: '100%', color: 'var(--sv-amber)' }}>{allocation.risk_reason}</div>}
          </div>)}
          {!readOnly && line.unsourced > 0 && line.candidates.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 7, marginTop: 9 }}>
            <select aria-label={`Incoming PO for ${line.sku || line.productName}`} value={draft.poItemId} onChange={event => setDrafts(current => ({ ...current, [line.soItemId]: { ...draft, poItemId: event.target.value } }))} style={fieldStyle}>
              <option value="">Select incoming PO</option>
              {line.candidates.map((candidate, index) => <option key={candidate.poItemId} value={candidate.poItemId}>{index === 0 ? 'FIFO: ' : ''}{candidate.poNumber} · {qty(candidate.freeQuantity)} free · {date(candidate.expectedDate)}</option>)}
            </select>
            <input aria-label={`Allocation quantity for ${line.sku || line.productName}`} type="number" min="0.0001" step="0.0001" placeholder="Quantity" value={draft.quantity} onChange={event => setDrafts(current => ({ ...current, [line.soItemId]: { ...draft, quantity: event.target.value } }))} style={fieldStyle} />
            <input aria-label={`Promise date for ${line.sku || line.productName}`} type="date" value={draft.promisedDate} onChange={event => setDrafts(current => ({ ...current, [line.soItemId]: { ...draft, promisedDate: event.target.value } }))} style={fieldStyle} />
            <button type="button" onClick={() => allocate(line)} disabled={!!busy} style={actionButton}>Allocate</button>
            {selectedIndex > 0 && <input aria-label={`FIFO override reason for ${line.sku || line.productName}`} placeholder="Reason for FIFO override" value={draft.reason} onChange={event => setDrafts(current => ({ ...current, [line.soItemId]: { ...draft, reason: event.target.value } }))} style={{ ...fieldStyle, gridColumn: '1 / -1' }} />}
          </div>}
          {line.unsourced > 0 && line.candidates.length === 0 && <div style={{ paddingTop: 7, fontSize: 12, color: 'var(--sv-amber)' }}>No eligible confirmed PO supply at this location. No customer date is promised.</div>}
        </div>;
      })}
      {mode === 'purchase_order' && items.map(item => {
        const linked = allocationsForItem(Number(item.id), 'po_item_id');
        const incoming = Math.max(0, Number(item.qty_ordered) - Number(item.qty_received ?? 0));
        const protectedQuantity = linked.reduce((sum, allocation) => sum + Math.max(0, Number(allocation.qty_allocated) - Number(allocation.qty_received_assigned)), 0);
        return <div key={item.id} style={{ padding: '10px 0', borderTop: '1px solid var(--sv-etch)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}><strong>{item.sku || item.product_name}</strong><span>Incoming {qty(incoming)}</span><span style={{ color: protectedQuantity > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)' }}>Protected {qty(protectedQuantity)}</span><span style={{ color: 'var(--sv-text-dim)' }}>Free {qty(Math.max(0, incoming - protectedQuantity))}</span></div>
          {linked.map(allocation => <div key={allocation.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingTop: 7, fontSize: 12 }}><span>{allocation.so_number}</span><span>{qty(allocation.qty_allocated)} allocated</span><span>{qty(allocation.qty_received_assigned)} ready</span><span style={{ color: allocation.promise_status === 'at_risk' ? 'var(--sv-amber)' : 'var(--sv-text-dim)' }}>{allocation.promise_status.replace('_', ' ')}</span>{!readOnly && <button type="button" onClick={() => release(allocation)} disabled={!!busy} style={{ ...smallButton, marginLeft: 'auto' }}><Link2Off size={13} /> Release</button>}</div>)}
        </div>;
      })}
    </section>
  );
}

const fieldStyle: React.CSSProperties = { minWidth: 0, padding: '6px 8px', border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 12 };
const actionButton: React.CSSProperties = { padding: '6px 11px', border: '1px solid var(--sv-mint)', borderRadius: 5, background: 'var(--sv-mint)', color: '#052e2b', fontSize: 12, fontWeight: 750, cursor: 'pointer' };
const smallButton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: '1px solid var(--sv-etch)', borderRadius: 4, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', fontSize: 11, cursor: 'pointer' };
