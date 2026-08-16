'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Combine, ExternalLink, RefreshCw, Search, X } from 'lucide-react';

type BackorderType = 'customer' | 'supplier';

type BackorderLine = {
  item_id: number;
  sku?: string | null;
  product_name?: string | null;
  variant_label?: string | null;
  qty_ordered: number;
  unit_amount: number;
  discount_pct?: number | null;
  tax_rate?: number | null;
  notes?: string | null;
  qty_on_hand: number;
  qty_committed: number;
  qty_incoming: number;
};

type Backorder = {
  id: number;
  type: BackorderType;
  contact_id: number | null;
  location_id: number;
  order_number: string;
  contact_name: string;
  location_name: string;
  expected_date?: string | null;
  created_at?: string | null;
  total_amount: number;
  currency_code?: string | null;
  exchange_rate?: number | null;
  tax_treatment?: string | null;
  tax_code?: string | null;
  payment_terms?: string | null;
  price_tier?: string | null;
  external_reference?: string | null;
  source_orders?: string | null;
  ready: boolean;
  item_count: number;
  total_qty: number;
  lines: BackorderLine[];
};

const buttonStyle = (tone: 'default' | 'primary' | 'danger' = 'default'): React.CSSProperties => ({
  height: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: `1px solid ${tone === 'primary' ? 'var(--sv-action)' : tone === 'danger' ? 'var(--sv-red)' : 'var(--sv-etch)'}`,
  background: tone === 'primary' ? 'var(--sv-action)' : tone === 'danger' ? 'rgba(239,68,68,.08)' : 'var(--sv-bg-2)',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? 'var(--sv-red)' : 'var(--sv-text-main)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 650,
});

const formatDate = (value?: string | null) => value ? String(value).slice(0, 10) : 'Not set';
const formatCurrency = (value: number, currency = 'AUD') => new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: currency || 'AUD', maximumFractionDigits: 2,
}).format(Number(value || 0));

const mergeCompatibilityKey = (order: Backorder) => JSON.stringify([
  order.type,
  order.contact_id,
  order.location_id,
  String(order.currency_code ?? 'AUD').toUpperCase(),
  Number(order.exchange_rate ?? 1),
  order.tax_treatment ?? 'ex_tax',
  order.tax_code?.trim() ?? '',
  order.payment_terms?.trim() ?? '',
  order.price_tier?.trim() ?? '',
  order.external_reference?.trim() ?? '',
]);

export function BackordersView({
  isAdvisor,
  onOpenOrder,
}: {
  isAdvisor: boolean;
  onOpenOrder: (type: BackorderType, id: number) => void;
}) {
  const [activeType, setActiveType] = useState<BackorderType>('customer');
  const [queues, setQueues] = useState<Record<BackorderType, Backorder[]>>({ customer: [], supplier: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [mergePreviewOpen, setMergePreviewOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ims/backorders');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load backorders.');
      setQueues({
        customer: Array.isArray(body.data?.customer) ? body.data.customer : [],
        supplier: Array.isArray(body.data?.supplier) ? body.data.supplier : [],
      });
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load backorders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queues[activeType];
    return queues[activeType].filter(order => [
      order.order_number,
      order.contact_name,
      order.source_orders,
      order.external_reference,
      ...order.lines.flatMap(line => [line.sku, line.product_name, line.variant_label]),
    ].some(value => String(value ?? '').toLowerCase().includes(needle)));
  }, [activeType, queues, search]);

  const selectedOrders = useMemo(() => queues[activeType]
    .filter(order => selectedIds.has(order.id))
    .sort((left, right) => String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) || left.id - right.id),
  [activeType, queues, selectedIds]);

  const selectedCompatibilityKey = selectedOrders[0] ? mergeCompatibilityKey(selectedOrders[0]) : null;

  const previewLines = useMemo(() => {
    const groups = new Map<string, { key: string; sku: string; product: string; variant: string; quantity: number }>();
    for (const order of selectedOrders) {
      for (const line of order.lines) {
        const key = JSON.stringify([line.sku ?? '', line.unit_amount, line.discount_pct ?? 0, line.tax_rate ?? 0, line.notes ?? '']);
        const existing = groups.get(key);
        if (existing) existing.quantity += Number(line.qty_ordered);
        else groups.set(key, {
          key,
          sku: line.sku || '—',
          product: line.product_name || 'Unknown product',
          variant: line.variant_label || 'Default',
          quantity: Number(line.qty_ordered),
        });
      }
    }
    return Array.from(groups.values());
  }, [selectedOrders]);

  const toggleSelected = (order: Backorder) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(order.id)) next.delete(order.id);
      else next.add(order.id);
      return next;
    });
  };

  const mergeSelected = async () => {
    if (selectedOrders.length < 2) return;
    setMerging(true);
    try {
      const operationKey = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `merge-${activeType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await fetch('/api/ims/backorders/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: activeType, orderIds: selectedOrders.map(order => order.id), operationKey }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Backorder merge failed.');
      setSelectedIds(new Set());
      setExpanded(null);
      setMergePreviewOpen(false);
      await load();
    } catch (mergeError: any) {
      window.alert(mergeError.message || 'Backorder merge failed.');
    } finally {
      setMerging(false);
    }
  };

  const runAction = async (order: Backorder, action: 'release' | 'cancel') => {
    const verb = action === 'release' ? 'Release' : 'Cancel';
    if (!window.confirm(`${verb} ${order.order_number}?`)) return;
    setWorkingId(order.id);
    try {
      const response = await fetch(`/api/ims/backorders/${order.type}/${order.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || `${verb} failed.`);
      setExpanded(null);
      await load();
    } catch (actionError: any) {
      window.alert(actionError.message || `${verb} failed.`);
    } finally {
      setWorkingId(null);
    }
  };

  const tabs: Array<{ type: BackorderType; label: string }> = [
    { type: 'customer', label: 'Customer' },
    { type: 'supplier', label: 'Supplier' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 260px' }}>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--sv-text-strong)' }}>Backorders</h1>
          <div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 13 }}>
            Held demand and incoming supply awaiting manual release.
          </div>
        </div>
        {selectedOrders.length > 0 && !isAdvisor && <>
          <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{selectedOrders.length} selected</span>
          <button onClick={() => setSelectedIds(new Set())} style={buttonStyle()}>Clear</button>
          <button onClick={() => setMergePreviewOpen(true)} disabled={selectedOrders.length < 2} style={{ ...buttonStyle('primary'), opacity: selectedOrders.length < 2 ? .45 : 1 }}>
            <Combine size={15} /> Merge
          </button>
        </>}
        <button onClick={load} disabled={loading} style={buttonStyle()} title="Refresh backorders">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--sv-etch)', borderRadius: 7, overflow: 'hidden' }}>
          {tabs.map(tab => (
            <button key={tab.type} onClick={() => { setActiveType(tab.type); setExpanded(null); setSelectedIds(new Set()); }} style={{
              height: 34,
              padding: '0 14px',
              border: 0,
              borderRight: tab.type === 'customer' ? '1px solid var(--sv-etch)' : 0,
              background: activeType === tab.type ? 'var(--sv-action)' : 'var(--sv-bg-2)',
              color: activeType === tab.type ? '#fff' : 'var(--sv-text-main)',
              cursor: 'pointer',
              fontWeight: 650,
            }}>
              {tab.label} ({queues[tab.type].length})
            </button>
          ))}
        </div>
        <label style={{ position: 'relative', flex: '1 1 240px', maxWidth: 420 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--sv-text-dim)' }} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search contact, order, SKU or product" style={{
            width: '100%', height: 34, boxSizing: 'border-box', border: '1px solid var(--sv-etch)', borderRadius: 6,
            background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '0 34px', fontSize: 13,
          }} />
          {search && <button onClick={() => setSearch('')} title="Clear search" style={{ position: 'absolute', right: 7, top: 6, border: 0, background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 3 }}><X size={15} /></button>}
        </label>
      </div>

      {error && <div style={{ padding: 12, border: '1px solid var(--sv-red)', color: 'var(--sv-red)', borderRadius: 6 }}>{error}</div>}
      {!error && loading && <div style={{ padding: 28, color: 'var(--sv-text-dim)' }}>Loading backorders...</div>}
      {!error && !loading && visible.length === 0 && (
        <div style={{ padding: '44px 20px', textAlign: 'center', borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>
          No {activeType} backorders match this view.
        </div>
      )}

      {!error && !loading && visible.length > 0 && (
        <div className="ims-sticky-table" style={{ borderTop: '1px solid var(--sv-etch)', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase' }}>
                {!isAdvisor && <th style={{ width: 34 }} />}
                <th style={{ width: 34 }} />
                {['Order', activeType === 'customer' ? 'Customer' : 'Supplier', 'Source', 'Location', 'Expected', 'Lines / Qty', 'Value', 'Readiness', 'Actions'].map(label => (
                  <th key={label} style={{ padding: '10px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(order => {
                const isExpanded = expanded === order.id;
                const isWorking = workingId === order.id;
                const isSelected = selectedIds.has(order.id);
                const isCompatible = !selectedCompatibilityKey || isSelected || mergeCompatibilityKey(order) === selectedCompatibilityKey;
                return (
                  <React.Fragment key={`${order.type}-${order.id}`}>
                    <tr style={{ borderBottom: '1px solid var(--sv-etch)', background: isExpanded ? 'var(--sv-bg-2)' : 'transparent' }}>
                      {!isAdvisor && <td style={{ padding: '8px 4px' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isCompatible}
                          onChange={() => toggleSelected(order)}
                          title={isCompatible ? 'Select for merge' : 'This backorder has different commercial terms.'}
                          aria-label={`Select ${order.order_number} for merge`}
                        />
                      </td>}
                      <td style={{ padding: '8px 4px' }}>
                        <button onClick={() => setExpanded(isExpanded ? null : order.id)} title={isExpanded ? 'Hide lines' : 'Show lines'} style={{ border: 0, background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 4 }}>
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td style={{ padding: 8, fontWeight: 700, color: 'var(--sv-text-strong)', whiteSpace: 'nowrap' }}>{order.order_number}</td>
                      <td style={{ padding: 8 }}>{order.contact_name}</td>
                      <td style={{ padding: 8, color: 'var(--sv-text-dim)' }}>{order.source_orders || 'Legacy / direct'}</td>
                      <td style={{ padding: 8 }}>{order.location_name}</td>
                      <td style={{ padding: 8 }}>{formatDate(order.expected_date)}</td>
                      <td style={{ padding: 8 }}>{order.item_count} / {Number(order.total_qty).toLocaleString('en-AU')}</td>
                      <td style={{ padding: 8 }}>{formatCurrency(order.total_amount, order.currency_code || 'AUD')}</td>
                      <td style={{ padding: 8 }}>
                        {activeType === 'customer' ? (
                          <span style={{ color: order.ready ? 'var(--sv-mint)' : 'var(--sv-orange)', fontWeight: 700, fontSize: 12 }}>
                            {order.ready ? 'Stock ready' : 'Awaiting stock'}
                          </span>
                        ) : <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Awaiting supplier</span>}
                      </td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => onOpenOrder(order.type, order.id)} style={buttonStyle()} title="Open order"><ExternalLink size={14} /></button>
                          {!isAdvisor && <button
                            onClick={() => runAction(order, 'release')}
                            disabled={isWorking || (order.type === 'customer' && !order.ready)}
                            title={order.type === 'customer' && !order.ready ? 'Committed stock is not yet available at this location.' : 'Release backorder'}
                            style={{ ...buttonStyle('primary'), opacity: isWorking || (order.type === 'customer' && !order.ready) ? .45 : 1 }}
                          >Release</button>}
                          {!isAdvisor && <button onClick={() => runAction(order, 'cancel')} disabled={isWorking} style={buttonStyle('danger')}>Cancel</button>}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)' }}>
                        {!isAdvisor && <td />}
                        <td />
                        <td colSpan={9} style={{ padding: '6px 8px 14px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr style={{ color: 'var(--sv-text-dim)' }}>{['SKU', 'Product', 'Variant', 'Backorder Qty', 'On Hand', 'Committed', 'Incoming'].map(label => <th key={label} style={{ textAlign: 'left', padding: '6px 8px' }}>{label}</th>)}</tr></thead>
                            <tbody>{order.lines.map(line => <tr key={line.item_id} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                              <td style={{ padding: '7px 8px' }}>{line.sku || '—'}</td>
                              <td style={{ padding: '7px 8px' }}>{line.product_name || 'Unknown product'}</td>
                              <td style={{ padding: '7px 8px' }}>{line.variant_label || '—'}</td>
                              <td style={{ padding: '7px 8px', fontWeight: 700 }}>{Number(line.qty_ordered).toLocaleString('en-AU')}</td>
                              <td style={{ padding: '7px 8px' }}>{Number(line.qty_on_hand).toLocaleString('en-AU')}</td>
                              <td style={{ padding: '7px 8px' }}>{Number(line.qty_committed).toLocaleString('en-AU')}</td>
                              <td style={{ padding: '7px 8px' }}>{Number(line.qty_incoming).toLocaleString('en-AU')}</td>
                            </tr>)}</tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mergePreviewOpen && selectedOrders.length >= 2 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', padding: 20 }} onMouseDown={() => { if (!merging) setMergePreviewOpen(false); }}>
          <div style={{ width: 'min(760px, 100%)', maxHeight: '88vh', overflow: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }} onMouseDown={event => event.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--sv-etch)' }}>
              <div>
                <div style={{ fontWeight: 750, color: 'var(--sv-text-strong)' }}>Merge {activeType} backorders</div>
                <div style={{ marginTop: 3, color: 'var(--sv-text-dim)', fontSize: 12 }}>The oldest document remains active; source documents are archived as cancelled.</div>
              </div>
              <button onClick={() => setMergePreviewOpen(false)} disabled={merging} title="Close" style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
                <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase' }}>Target</div><strong>{selectedOrders[0].order_number}</strong></div>
                <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase' }}>{activeType === 'customer' ? 'Customer' : 'Supplier'}</div><strong>{selectedOrders[0].contact_name}</strong></div>
                <div><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase' }}>Combined value</div><strong>{formatCurrency(selectedOrders.reduce((sum, order) => sum + Number(order.total_amount), 0), selectedOrders[0].currency_code || 'AUD')}</strong></div>
              </div>
              <div style={{ marginBottom: 14, color: 'var(--sv-text-dim)', fontSize: 12 }}>
                Sources: {selectedOrders.slice(1).map(order => order.order_number).join(', ')}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>{['SKU', 'Product', 'Variant', 'Combined qty'].map(label => <th key={label} style={{ textAlign: 'left', padding: '7px 8px' }}>{label}</th>)}</tr></thead>
                <tbody>{previewLines.map(line => <tr key={line.key} style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                  <td style={{ padding: '8px' }}>{line.sku}</td><td style={{ padding: '8px' }}>{line.product}</td><td style={{ padding: '8px' }}>{line.variant}</td><td style={{ padding: '8px', fontWeight: 700 }}>{line.quantity.toLocaleString('en-AU')}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--sv-etch)' }}>
              <button onClick={() => setMergePreviewOpen(false)} disabled={merging} style={buttonStyle()}>Cancel</button>
              <button onClick={mergeSelected} disabled={merging} style={buttonStyle('primary')}><Combine size={15} /> {merging ? 'Merging...' : `Merge ${selectedOrders.length} backorders`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}