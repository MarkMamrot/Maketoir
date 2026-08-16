"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { SBDatePicker, SBDateRange } from './reportFilterHelpers';
import { ReportScrollTable } from './ReportScrollTable';

interface SalesSearchViewProps {
  onBack: () => void;
  apiFetch: (url: string, opts?: RequestInit) => Promise<any>;
  today: () => string;
  fmtCurrency: (n: number) => string;
}

interface SalesRow {
  variant_id: string;
  sku: string;
  product_name: string;
  option_label: string;
  brand: string;
  supplier_name: string;
  qty: number;
  revenue: number;
  pos_qty: number;
  online_qty: number;
  wholesale_qty: number;
  history_qty: number;
}

export function SalesSearchView({ onBack, apiFetch, fmtCurrency }: SalesSearchViewProps) {
  const [rows, setRows]         = useState<SalesRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [totalRev, setTotalRev] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const [filterText, setFilterText] = useState('');
  const [dateRange, setDateRange]   = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(50);

  const [sortCol, setSortCol] = useState<string>('qty');
  const [sortAsc, setSortAsc] = useState(false);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const load = useCallback(async (
    pg: number, ft: string, dr: SBDateRange, ps: number,
  ) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: String(ps) });
      if (ft) params.set('q', ft);
      if (dr.kind === 'window') {
        params.set('days', String(dr.window));
      } else {
        params.set('from', dr.from);
        params.set('to', dr.to);
      }
      const data = await apiFetch(`/api/ims/reports/sales-search?${params}`);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setTotalQty(Number(data.totalQty ?? 0));
      setTotalRev(Number(data.totalRevenue ?? 0));
    } catch (e: any) {
      setError(e.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(1, '', { kind: 'window', window: 90, label: '90 Days' }, 50); }, [load]);

  const handleDateChange = (dr: SBDateRange) => { setDateRange(dr); setPage(1); load(1, filterText, dr, pageSize); };
  const goPage = (pg: number) => { setPage(pg); load(pg, filterText, dateRange, pageSize); };
  const changePageSize = (ps: number) => { setPageSize(ps); setPage(1); load(1, filterText, dateRange, ps); };

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  };

  const displayRows = React.useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortCol === 'qty') return (a.qty - b.qty) * dir;
      if (sortCol === 'revenue') return (a.revenue - b.revenue) * dir;
      if (sortCol === 'product') return String(a.product_name + a.option_label).localeCompare(String(b.product_name + b.option_label)) * dir;
      if (sortCol === 'sku') return String(a.sku ?? '').localeCompare(String(b.sku ?? '')) * dir;
      if (sortCol === 'brand') return String(a.brand ?? '').localeCompare(String(b.brand ?? '')) * dir;
      return 0;
    });
  }, [rows, sortCol, sortAsc]);

  const downloadCsv = () => {
    const headers = ['#', 'Product', 'Option', 'SKU', 'Brand', 'Supplier', 'Total Qty', 'Revenue (inc. GST)', 'POS Qty', 'Online Qty', 'Wholesale Qty', 'History Qty'];
    const lines = [headers.map(h => `"${h}"`).join(',')];
    displayRows.forEach((row, i) => {
      lines.push([
        String(i + 1),
        `"${(row.product_name || '').replace(/"/g, '""')}"`,
        `"${(row.option_label || '').replace(/"/g, '""')}"`,
        `"${(row.sku || '').replace(/"/g, '""')}"`,
        `"${(row.brand || '').replace(/"/g, '""')}"`,
        `"${(row.supplier_name || '').replace(/"/g, '""')}"`,
        String(row.qty),
        row.revenue.toFixed(2),
        String(row.pos_qty),
        String(row.online_qty),
        String(row.wholesale_qty),
        String(row.history_qty),
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sales-search-${new Date().toLocaleDateString('sv-SE')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pageRange = (): (number | '...')[] => {
    const r: (number | '...')[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) r.push(i); }
    else {
      r.push(1);
      if (page > 3) r.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
      if (page < totalPages - 2) r.push('...');
      r.push(totalPages);
    }
    return r;
  };

  const cellStyle: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13, whiteSpace: 'nowrap' };
  const hCell: React.CSSProperties    = { ...cellStyle, fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, background: 'var(--sv-bg-2)', verticalAlign: 'top' };
  const numCell: React.CSSProperties  = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' as any };
  const numHCell: React.CSSProperties = { ...hCell, textAlign: 'right' };

  const arrow = (col: string) => (
    <span style={{ marginLeft: 3, fontSize: 9, opacity: sortCol === col ? 1 : 0.3 }}>
      {sortCol === col ? (sortAsc ? '\u25B2' : '\u25BC') : '\u2195'}
    </span>
  );
  const sortTh = (col: string, label: string, extra?: React.CSSProperties) => (
    <th onClick={() => toggleSort(col)} style={{ ...hCell, cursor: 'pointer', userSelect: 'none', ...extra }}>
      {label}{arrow(col)}
    </th>
  );
  const columnWidths = [44, 220, 120, 120, 160, 110, 130, 90, 90, 100, 90];
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const renderColGroup = () => <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Reports
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Sales Search</h1>
        <button
          onClick={downloadCsv}
          disabled={displayRows.length === 0}
          style={{ height: 34, padding: '0 12px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: displayRows.length === 0 ? 'not-allowed' : 'pointer', opacity: displayRows.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>

      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Search product name or SKU…"
          value={filterText}
          onChange={e => { const v = e.target.value; setFilterText(v); setPage(1); load(1, v, dateRange, pageSize); }}
          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterText ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, flex: '1 1 200px', minWidth: 160 }}
        />
        <SBDatePicker value={dateRange} onChange={handleDateChange} />
        {!loading && total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
            {total.toLocaleString()} variant{total !== 1 ? 's' : ''} &middot; {totalQty.toLocaleString()} units &middot; {fmtCurrency(totalRev)}
          </span>
        )}
        {loading && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading&hellip;</span>}
        {filterText && (
          <button
            onClick={() => { setFilterText(''); setPage(1); load(1, '', dateRange, pageSize); }}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--sv-red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--sv-red) 10%, transparent)', borderRadius: 6 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ReportScrollTable
          ariaLabel="Sales search table. Use arrow keys to scroll."
          bodyClassName="sales-search-table-scroll"
          tableWidth={tableWidth}
          renderColGroup={renderColGroup}
          headerRows={
              <tr style={{ background: 'var(--sv-bg-2)' }}>
                <th style={{ ...hCell, width: 44, textAlign: 'right', position: 'sticky', left: 0, zIndex: 4 }}>#</th>
                {sortTh('product', 'Product', { position: 'sticky', left: 44, zIndex: 4, minWidth: 220, boxShadow: '1px 0 0 var(--sv-etch)' })}
                {sortTh('sku', 'SKU')}
                {sortTh('brand', 'Brand')}
                <th style={hCell}>Supplier</th>
                {sortTh('qty', 'Units Sold', { ...numHCell })}
                {sortTh('revenue', 'Revenue', { ...numHCell })}
                <th style={numHCell}>POS</th>
                <th style={numHCell}>Online</th>
                <th style={numHCell}>Wholesale</th>
                <th style={numHCell}>History</th>
              </tr>
          }
        >
            <tbody>
              {loading && (
                <tr><td colSpan={11} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>Loading&hellip;</td></tr>
              )}
              {!loading && displayRows.length === 0 && (
                <tr><td colSpan={11} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>No results found.</td></tr>
              )}
              {!loading && displayRows.map((row, i) => {
                const rowBg = i % 2 === 0 ? 'var(--sv-bg-1)' : 'color-mix(in srgb, var(--sv-bg-1) 65%, var(--sv-etch))';
                const rowNum = (page - 1) * pageSize + i + 1;
                return (
                  <tr key={row.variant_id} style={{ background: rowBg }}>
                    <td style={{ ...numCell, position: 'sticky', left: 0, zIndex: 1, background: rowBg, color: 'var(--sv-text-dim)', fontSize: 11 }}>{rowNum}</td>
                    <td style={{ ...cellStyle, position: 'sticky', left: 44, zIndex: 1, background: rowBg, minWidth: 220, boxShadow: '1px 0 0 var(--sv-etch)' }}>
                      <div style={{ fontWeight: 500, color: 'var(--sv-text-strong)' }}>{row.product_name}</div>
                      {row.option_label && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 1 }}>{row.option_label}</div>}
                    </td>
                    <td style={{ ...cellStyle, color: 'var(--sv-text-dim)', fontFamily: 'monospace', fontSize: 12 }}>{row.sku || '—'}</td>
                    <td style={cellStyle}>{row.brand || '—'}</td>
                    <td style={cellStyle}>{row.supplier_name || '—'}</td>
                    <td style={{ ...numCell, color: row.qty > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)', fontWeight: row.qty > 0 ? 600 : 400 }}>
                      {row.qty.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                    </td>
                    <td style={{ ...numCell, fontWeight: 500 }}>{fmtCurrency(row.revenue)}</td>
                    <td style={{ ...numCell, color: row.pos_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>{row.pos_qty > 0 ? row.pos_qty : '—'}</td>
                    <td style={{ ...numCell, color: row.online_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>{row.online_qty > 0 ? row.online_qty : '—'}</td>
                    <td style={{ ...numCell, color: row.wholesale_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>{row.wholesale_qty > 0 ? row.wholesale_qty : '—'}</td>
                    <td style={{ ...numCell, color: row.history_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>{row.history_qty > 0 ? row.history_qty : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
        </ReportScrollTable>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => goPage(page - 1)} disabled={page <= 1 || loading}
                style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: 13, color: 'var(--sv-text-main)' }}
              >&larr;</button>
              {pageRange().map((p, i) =>
                p === '...'
                  ? <span key={`e${i}`} style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 4px' }}>&hellip;</span>
                  : <button
                      key={p}
                      onClick={() => goPage(p as number)}
                      disabled={loading}
                      style={{ height: 30, minWidth: 30, borderRadius: 6, border: '1px solid var(--sv-etch)', background: p === page ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: p === page ? '#fff' : 'var(--sv-text-main)', fontWeight: p === page ? 600 : 400, cursor: 'pointer', fontSize: 13 }}
                    >{p}</button>
              )}
              <button
                onClick={() => goPage(page + 1)} disabled={page >= totalPages || loading}
                style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: 13, color: 'var(--sv-text-main)' }}
              >&rarr;</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sv-text-dim)' }}>
              <span>Page {page} of {totalPages} &middot; {total.toLocaleString()} variants</span>
              <select
                value={pageSize} onChange={e => changePageSize(Number(e.target.value))}
                style={{ height: 28, padding: '0 6px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: 'pointer' }}
              >
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
