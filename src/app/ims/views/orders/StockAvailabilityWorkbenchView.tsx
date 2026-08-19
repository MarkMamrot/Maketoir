'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Search, X } from 'lucide-react';
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';
import { getFifoAllocationDraft, type StockAllocationCandidate } from './stockAvailabilityActions';

type Issue = 'at_risk' | 'overdue' | 'unsourced' | 'ready' | 'incoming' | 'held';
type Lens = 'all' | Issue;

type AvailabilityRow = {
  so_id: number;
  so_item_id: number;
  so_number: string;
  status: string;
  customer_name: string;
  location_name: string;
  sku: string | null;
  product_name: string;
  variant_label: string | null;
  supplier_names: string | null;
  earliest_incoming_date: string | null;
  qty_on_hand: number;
  outstanding: number;
  protected: number;
  ready: number;
  incoming: number;
  unsourced: number;
  issues: Issue[];
};

type FifoModalState = {
  row: AvailabilityRow;
  candidate: StockAllocationCandidate | null;
  maxQuantity: number;
  quantity: string;
  promisedDate: string;
  loading: boolean;
  submitting: boolean;
  error: string;
};

const LENSES: Array<{ id: Lens; label: string }> = [
  { id: 'all', label: 'All demand' },
  { id: 'unsourced', label: 'Unsourced' },
  { id: 'ready', label: 'Ready' },
  { id: 'at_risk', label: 'At risk' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'held', label: 'Held' },
];

const COLUMN_WIDTHS = [110, 190, 250, 150, 150, 95, 95, 95, 95, 95, 120, 120, 104];
const TABLE_WIDTH = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
const control: React.CSSProperties = {
  height: 34,
  border: '1px solid var(--sv-etch)',
  borderRadius: 6,
  background: 'var(--sv-bg-1)',
  color: 'var(--sv-text-main)',
  padding: '0 10px',
  fontSize: 12,
};
const number = (value: number) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(value);
const date = (value: string | null) => value ? value.slice(0, 10) : 'Not set';

const statusLabel = (row: AvailabilityRow) => {
  if (row.issues.includes('at_risk')) return { label: 'At risk', color: 'var(--sv-red)' };
  if (row.issues.includes('overdue')) return { label: 'Overdue', color: '#d97706' };
  if (row.issues.includes('unsourced')) return { label: 'Unsourced', color: '#d97706' };
  if (row.issues.includes('ready')) return { label: 'Ready', color: 'var(--sv-green)' };
  return { label: 'Incoming', color: 'var(--sv-action)' };
};

export function StockAvailabilityWorkbenchView({
  isAdvisor,
  onOpenSalesOrder,
}: {
  isAdvisor: boolean;
  onOpenSalesOrder: (id: number) => void;
}) {
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lens, setLens] = useState<Lens>('all');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [supplier, setSupplier] = useState('');
  const [fifoModal, setFifoModal] = useState<FifoModalState | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  useTableArrowScroll(bodyScrollRef);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ims/stock-availability');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load stock availability.');
      setRows(Array.isArray(body.data) ? body.data : []);
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load stock availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openFifoModal = async (row: AvailabilityRow) => {
    setFifoModal({ row, candidate: null, maxQuantity: 0, quantity: '', promisedDate: '', loading: true, submitting: false, error: '' });
    try {
      const response = await fetch(`/api/ims/stock-allocations?candidatesForSo=${row.so_id}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load current incoming supply.');
      const draft = getFifoAllocationDraft(Array.isArray(body.data) ? body.data : [], row.so_item_id);
      if (!draft) throw new Error('No eligible confirmed PO supply remains for this line. Refresh the workbench and review the sales order.');
      setFifoModal(current => current?.row.so_item_id === row.so_item_id ? {
        ...current,
        candidate: draft.candidate,
        maxQuantity: draft.maxQuantity,
        quantity: String(draft.maxQuantity),
        loading: false,
      } : current);
    } catch (loadError: any) {
      setFifoModal(current => current?.row.so_item_id === row.so_item_id ? {
        ...current,
        loading: false,
        error: loadError.message || 'Failed to load current incoming supply.',
      } : current);
    }
  };

  const submitFifoAllocation = async () => {
    if (!fifoModal?.candidate) return;
    const quantity = Number(fifoModal.quantity);
    if (!(quantity > 0) || quantity > fifoModal.maxQuantity) {
      setFifoModal(current => current ? { ...current, error: `Quantity must be between 0 and ${number(current.maxQuantity)}.` } : current);
      return;
    }
    setFifoModal(current => current ? { ...current, submitting: true, error: '' } : current);
    try {
      const operationKey = `workbench-fifo-${fifoModal.row.so_item_id}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
      const response = await fetch('/api/ims/stock-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationKey,
          soItemId: fifoModal.row.so_item_id,
          poItemId: fifoModal.candidate.poItemId,
          quantity,
          promisedDate: fifoModal.promisedDate || null,
          priority: 0,
          overrideReason: null,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'FIFO allocation failed.');
      setFifoModal(null);
      await load();
    } catch (allocationError: any) {
      setFifoModal(current => current ? {
        ...current,
        submitting: false,
        error: allocationError.message || 'FIFO allocation failed. Refresh and try again.',
      } : current);
    }
  };

  const locations = useMemo(() => [...new Set(rows.map(row => row.location_name).filter(Boolean))].sort(), [rows]);
  const suppliers = useMemo(() => [...new Set(rows.flatMap(row => String(row.supplier_names ?? '').split(', ')).filter(Boolean))].sort(), [rows]);
  const counts = useMemo(() => Object.fromEntries(LENSES.map(item => {
    if (item.id === 'all') return [item.id, rows.length];
    const issue: Issue = item.id;
    return [item.id, rows.filter(row => row.issues.includes(issue)).length];
  })), [rows]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(row => {
      if (lens !== 'all' && !row.issues.includes(lens)) return false;
      if (location && row.location_name !== location) return false;
      if (supplier && !String(row.supplier_names ?? '').split(', ').includes(supplier)) return false;
      if (!needle) return true;
      return [row.so_number, row.customer_name, row.sku, row.product_name, row.variant_label, row.supplier_names]
        .some(value => String(value ?? '').toLowerCase().includes(needle));
    });
  }, [lens, location, rows, search, supplier]);

  const colGroup = () => <colgroup>{COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;
  const stickyCell = (background: string): React.CSSProperties => ({
    position: 'sticky', left: 0, zIndex: 2, background,
    boxShadow: '3px 0 5px rgba(0,0,0,.12)',
  });

  return (
    <div style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--sv-text-strong)' }}>Stock Allocation</h1>
          <div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 13 }}>Open customer demand, protected incoming stock, and supply exceptions.</div>
        </div>
        <button onClick={load} disabled={loading} title="Refresh stock allocation" style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', overflowX: 'auto', borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)', marginBottom: 14 }}>
        {LENSES.map(item => <button key={item.id} onClick={() => setLens(item.id)} style={{
          minWidth: 112, minHeight: 58, padding: '8px 12px', border: 0, borderRight: '1px solid var(--sv-etch)',
          borderBottom: lens === item.id ? '3px solid var(--sv-action)' : '3px solid transparent',
          background: lens === item.id ? 'var(--sv-bg-2)' : 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer', textAlign: 'left',
        }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--sv-text-dim)' }}>{item.label}</span>
          <strong style={{ display: 'block', marginTop: 3, fontSize: 18, color: 'var(--sv-text-strong)' }}>{counts[item.id] ?? 0}</strong>
        </button>)}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ position: 'relative', flex: '1 1 260px', maxWidth: 460 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--sv-text-dim)' }} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search order, customer, SKU, product or supplier" style={{ ...control, width: '100%', boxSizing: 'border-box', paddingLeft: 34, paddingRight: 34 }} />
          {search && <button onClick={() => setSearch('')} title="Clear search" style={{ position: 'absolute', right: 6, top: 6, border: 0, background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 3 }}><X size={15} /></button>}
        </label>
        <select aria-label="Filter by location" value={location} onChange={event => setLocation(event.target.value)} style={{ ...control, minWidth: 170 }}>
          <option value="">All locations</option>
          {locations.map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by supplier" value={supplier} onChange={event => setSupplier(event.target.value)} style={{ ...control, minWidth: 180 }}>
          <option value="">All suppliers</option>
          {suppliers.map(value => <option key={value}>{value}</option>)}
        </select>
      </div>

      {error && <div style={{ padding: 12, borderTop: '1px solid var(--sv-red)', borderBottom: '1px solid var(--sv-red)', color: 'var(--sv-red)' }}>{error}</div>}
      {!error && loading && <div style={{ padding: '38px 12px', color: 'var(--sv-text-dim)' }}>Loading stock availability...</div>}
      {!error && !loading && visible.length === 0 && <div style={{ padding: '44px 16px', textAlign: 'center', borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>No demand lines match this view.</div>}

      {!error && !loading && visible.length > 0 && <div style={{ width: '100%', minWidth: 0, borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)' }}>
        <div ref={headerScrollRef} style={{ position: 'sticky', top: 0, zIndex: 4, overflow: 'hidden', background: 'var(--sv-bg-2)' }}>
          <table style={{ width: TABLE_WIDTH, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
            {colGroup()}
            <thead><tr>{['SO', 'Customer', 'Product', 'Location', 'Supplier', 'Outstanding', 'Protected', 'Ready', 'Incoming', 'Unsourced', 'ETA', 'State', ''].map((label, index) => <th key={label || index} style={{
              ...(index === 0 ? stickyCell('var(--sv-bg-2)') : {}), padding: '10px 8px', textAlign: index >= 5 && index <= 9 ? 'right' : 'left',
              borderBottom: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap', zIndex: index === 0 ? 5 : undefined,
            }}>{label}</th>)}</tr></thead>
          </table>
        </div>
        <div ref={bodyScrollRef} className="ims-sticky-table ims-sticky-table--self-scroll stock-availability-table-scroll" role="region" tabIndex={0} aria-label="Stock allocation table. Use arrow keys to scroll." onScroll={event => {
          if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <table style={{ width: TABLE_WIDTH, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
            {colGroup()}
            <tbody>{visible.map(row => {
              const state = statusLabel(row);
              const background = 'var(--sv-bg-1)';
              const product = [row.product_name, row.variant_label].filter(Boolean).join(' / ');
              const cells: React.ReactNode[] = [
                <strong key="so">{row.so_number}</strong>,
                row.customer_name,
                <span key="product"><strong style={{ display: 'block', color: 'var(--sv-text-strong)' }}>{row.sku || product}</strong><span style={{ display: 'block', marginTop: 2, color: 'var(--sv-text-dim)', fontSize: 11 }}>{product}</span></span>,
                row.location_name,
                row.supplier_names || 'Not allocated',
                number(row.outstanding), number(row.protected), number(row.ready), number(row.incoming), number(row.unsourced),
                date(row.earliest_incoming_date),
                <span key="state" style={{ color: state.color, fontWeight: 700 }}>{state.label}</span>,
                <span key="actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  {!isAdvisor && row.unsourced > 0 && <button type="button" onClick={() => openFifoModal(row)} title={`Allocate FIFO supply to ${row.so_number}`} aria-label={`Allocate FIFO supply to ${row.so_number}`} style={{ border: 0, background: 'none', color: 'var(--sv-green)', cursor: 'pointer', padding: 5 }}><Link2 size={16} /></button>}
                  <button type="button" onClick={() => onOpenSalesOrder(row.so_id)} title={`Open ${row.so_number}`} aria-label={`Open ${row.so_number}`} style={{ border: 0, background: 'none', color: 'var(--sv-action)', cursor: 'pointer', padding: 5 }}><ExternalLink size={16} /></button>
                </span>,
              ];
              return <tr key={row.so_item_id}>{cells.map((cell, index) => <td key={index} style={{
                ...(index === 0 ? stickyCell(background) : { background }), padding: '9px 8px', borderBottom: '1px solid var(--sv-etch)',
                color: 'var(--sv-text-main)', fontSize: 12, verticalAlign: 'top', textAlign: index >= 5 && index <= 9 ? 'right' : 'left', overflowWrap: 'anywhere',
              }}>{cell}</td>)}</tr>;
            })}</tbody>
          </table>
        </div>
      </div>}

      {fifoModal && <div role="dialog" aria-modal="true" aria-labelledby="fifo-allocation-title" data-testid="fifo-allocation-modal" style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.58)', display: 'grid', placeItems: 'center', padding: 16,
      }}>
        <div style={{ width: 'min(480px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 18px 55px rgba(0,0,0,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--sv-etch)' }}>
            <Link2 size={17} aria-hidden="true" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 id="fifo-allocation-title" style={{ margin: 0, fontSize: 15, color: 'var(--sv-text-strong)' }}>Allocate FIFO supply</h2>
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--sv-text-dim)' }}>{fifoModal.row.so_number} · {fifoModal.row.sku || fifoModal.row.product_name}</div>
            </div>
            <button type="button" onClick={() => setFifoModal(null)} disabled={fifoModal.submitting} title="Close" aria-label="Close FIFO allocation" style={{ border: 0, background: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 4 }}><X size={17} /></button>
          </div>
          <div style={{ padding: 16 }}>
            {fifoModal.loading && <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Checking current incoming supply...</div>}
            {!fifoModal.loading && fifoModal.candidate && <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '7px 16px', padding: '10px 0 14px', borderBottom: '1px solid var(--sv-etch)', fontSize: 12 }}>
                <span style={{ color: 'var(--sv-text-dim)' }}>First eligible PO</span><strong>{fifoModal.candidate.poNumber}</strong>
                <span style={{ color: 'var(--sv-text-dim)' }}>Expected</span><span>{date(fifoModal.candidate.expectedDate)}</span>
                <span style={{ color: 'var(--sv-text-dim)' }}>Free incoming</span><span>{number(fifoModal.candidate.freeQuantity)}</span>
                <span style={{ color: 'var(--sv-text-dim)' }}>Current unsourced</span><span>{number(fifoModal.maxQuantity)}</span>
              </div>
              <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--sv-text-dim)' }}>
                  Quantity
                  <input type="number" min="0.0001" max={fifoModal.maxQuantity} step="0.0001" value={fifoModal.quantity} onChange={event => setFifoModal(current => current ? { ...current, quantity: event.target.value, error: '' } : current)} style={{ ...control, width: '100%', boxSizing: 'border-box' }} />
                </label>
                <label style={{ display: 'grid', gap: 5, fontSize: 12, color: 'var(--sv-text-dim)' }}>
                  Customer promise date <span style={{ fontSize: 10 }}>(optional)</span>
                  <input type="date" value={fifoModal.promisedDate} onChange={event => setFifoModal(current => current ? { ...current, promisedDate: event.target.value, error: '' } : current)} style={{ ...control, width: '100%', boxSizing: 'border-box' }} />
                </label>
              </div>
            </>}
            {fifoModal.error && <div role="alert" style={{ marginTop: 12, padding: '8px 10px', border: '1px solid var(--sv-red)', color: 'var(--sv-red)', fontSize: 12 }}>{fifoModal.error}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--sv-etch)' }}>
            <button type="button" onClick={() => setFifoModal(null)} disabled={fifoModal.submitting} style={{ ...control, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={submitFifoAllocation} disabled={fifoModal.loading || fifoModal.submitting || !fifoModal.candidate} style={{ ...control, borderColor: 'var(--sv-green)', background: 'var(--sv-green)', color: '#052e2b', fontWeight: 750, cursor: 'pointer', opacity: fifoModal.loading || fifoModal.submitting || !fifoModal.candidate ? .5 : 1 }}>
              {fifoModal.submitting ? 'Allocating...' : 'Confirm allocation'}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}