'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

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

const LENSES: Array<{ id: Lens; label: string }> = [
  { id: 'all', label: 'All demand' },
  { id: 'unsourced', label: 'Unsourced' },
  { id: 'ready', label: 'Ready' },
  { id: 'at_risk', label: 'At risk' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'held', label: 'Held' },
];

const COLUMN_WIDTHS = [110, 190, 250, 150, 150, 95, 95, 95, 95, 95, 120, 120, 72];
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

export function StockAvailabilityWorkbenchView({ onOpenSalesOrder }: { onOpenSalesOrder: (id: number) => void }) {
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lens, setLens] = useState<Lens>('all');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [supplier, setSupplier] = useState('');
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

  const locations = useMemo(() => [...new Set(rows.map(row => row.location_name).filter(Boolean))].sort(), [rows]);
  const suppliers = useMemo(() => [...new Set(rows.flatMap(row => String(row.supplier_names ?? '').split(', ')).filter(Boolean))].sort(), [rows]);
  const counts = useMemo(() => Object.fromEntries(LENSES.map(item => [item.id, item.id === 'all' ? rows.length : rows.filter(row => row.issues.includes(item.id)).length])), [rows]);
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
          <h1 style={{ margin: 0, fontSize: 22, color: 'var(--sv-text-strong)' }}>Stock Availability</h1>
          <div style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 13 }}>Open customer demand, protected incoming stock, and supply exceptions.</div>
        </div>
        <button onClick={load} disabled={loading} title="Refresh stock availability" style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
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
        <div ref={bodyScrollRef} className="ims-sticky-table ims-sticky-table--self-scroll stock-availability-table-scroll" role="region" tabIndex={0} aria-label="Stock availability table. Use arrow keys to scroll." onScroll={event => {
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
                <button key="open" onClick={() => onOpenSalesOrder(row.so_id)} title={`Open ${row.so_number}`} style={{ border: 0, background: 'none', color: 'var(--sv-action)', cursor: 'pointer', padding: 5 }}><ExternalLink size={16} /></button>,
              ];
              return <tr key={row.so_item_id}>{cells.map((cell, index) => <td key={index} style={{
                ...(index === 0 ? stickyCell(background) : { background }), padding: '9px 8px', borderBottom: '1px solid var(--sv-etch)',
                color: 'var(--sv-text-main)', fontSize: 12, verticalAlign: 'top', textAlign: index >= 5 && index <= 9 ? 'right' : 'left', overflowWrap: 'anywhere',
              }}>{cell}</td>)}</tr>;
            })}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}