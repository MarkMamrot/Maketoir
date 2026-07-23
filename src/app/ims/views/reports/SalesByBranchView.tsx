import React, { useCallback, useEffect, useState } from 'react';
import { SBDatePicker, SBDateRange } from './reportFilterHelpers';

interface SalesByBranchViewProps {
  onBack: () => void;
  apiFetch: (url: string, opts?: RequestInit) => Promise<any>;
}

export function SalesByBranchView({ onBack, apiFetch }: SalesByBranchViewProps) {
  const [rows, setRows]             = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  const [locations, setLocations]   = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const [filterText,     setFilterText]     = useState('');
  const [filterBrand,    setFilterBrand]    = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterType,     setFilterType]     = useState('');
  const [brandsOptions,  setBrandsOptions]  = useState<string[]>([]);
  const [suppliersOptions, setSuppliersOptions] = useState<{ id: number; name: string }[]>([]);
  const [dateRange, setDateRange] = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });
  const [page,     setPage]    = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);

  const [sortCol, setSortCol] = useState<string>('sales');
  const [sortAsc, setSortAsc] = useState(false);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const load = useCallback(async (pg: number, ft: string, fb: string, fs_: string, ftype: string, dr: SBDateRange, ps: number, bid: number | null = null) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(pg), pageSize: String(ps) });
      if (ft)    params.set('q',            ft);
      if (fb)    params.set('brand',         fb);
      if (fs_)   params.set('supplierName',  fs_);
      if (ftype) params.set('productType',   ftype);
      if (dr.kind === 'window') {
        params.set('window', String(dr.window));
      } else {
        params.set('from', dr.from);
        params.set('to', dr.to);
      }
      if (bid) params.set('locationIds', String(bid));
      const data = await apiFetch(`/api/ims/reports/sales-by-branch?${params}`);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setLocations(data.locations ?? []);
      if (data.brands)    setBrandsOptions(data.brands);
      if (data.suppliers) setSuppliersOptions(data.suppliers);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(1, '', '', '', '', { kind: 'window', window: 90, label: '90 Days' }, 25, null); }, [load]);

  const handleDateChange   = (dr: SBDateRange) => { setDateRange(dr); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dr, pageSize, branchFilter); };
  const handleBranchChange = (bid: number | null) => { setBranchFilter(bid); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dateRange, pageSize, bid); };
  const goPage             = (pg: number)       => { setPage(pg); load(pg, filterText, filterBrand, filterSupplier, filterType, dateRange, pageSize, branchFilter); };
  const changePageSize     = (ps: number)       => { setPageSize(ps); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dateRange, ps, branchFilter); };

  const salesKey = dateRange.kind === 'range'
    ? 'sales_qty_custom'
    : dateRange.window <= 7 ? 'sales_qty_7d' : dateRange.window <= 90 ? 'sales_qty_90d' : dateRange.window <= 180 ? 'sales_qty_180d' : 'sales_qty_12m';

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  };

  const displayRows = React.useMemo(() => {
    let r = [...rows];
    const dir = sortAsc ? 1 : -1;
    r.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortCol === 'sales') { av = Number(a[salesKey] ?? 0); bv = Number(b[salesKey] ?? 0); }
      else if (sortCol === 'soh') { av = Number(a.global_soh ?? 0); bv = Number(b.global_soh ?? 0); }
      else if (sortCol === 'product') { av = (a.product_name ?? '') + (a.option_label ?? ''); bv = (b.product_name ?? '') + (b.option_label ?? ''); }
      else if (sortCol === 'sku') { av = a.sku ?? ''; bv = b.sku ?? ''; }
      else if (sortCol === 'brand') { av = a.brand ?? ''; bv = b.brand ?? ''; }
      else if (sortCol === 'supplier') { av = a.supplier_name ?? ''; bv = b.supplier_name ?? ''; }
      else if (sortCol.startsWith('loc_')) {
        const lid = Number(sortCol.slice(4));
        av = Number(a.stock?.find((s: any) => s.location_id === lid)?.soh ?? 0);
        bv = Number(b.stock?.find((s: any) => s.location_id === lid)?.soh ?? 0);
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return r;
  }, [rows, sortCol, sortAsc, salesKey]);

  const downloadCsv = () => {
    const locHeaders = locations.map(l => l.name);
    const headers = ['#', 'Product', 'Option', 'SKU', 'Brand', 'Supplier', `Sales (${dateRange.label})`, 'Global SOH', ...locHeaders];
    const lines = [headers.map(h => `"${h}"`).join(',')];
    displayRows.forEach((row, i) => {
      const sq = Number(row[salesKey] ?? 0);
      const locCols = locations.map(l => { const s = row.stock?.find((x: any) => x.location_id === l.id); return String(s ? Number(s.soh) : 0); });
      lines.push([
        String((page - 1) * pageSize + i + 1),
        `"${(row.product_name || '').replace(/"/g, '""')}"`,
        `"${(row.option_label || '').replace(/"/g, '""')}"`,
        `"${(row.sku || '').replace(/"/g, '""')}"`,
        `"${(row.brand || '').replace(/"/g, '""')}"`,
        `"${(row.supplier_name || '').replace(/"/g, '""')}"`,
        String(sq), String(Number(row.global_soh ?? 0)), ...locCols,
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sales-by-branch-${new Date().toLocaleDateString('sv-SE')}.csv`; a.click();
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
  const hCell: React.CSSProperties    = { ...cellStyle, fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, background: 'var(--sv-bg-2)', verticalAlign: 'top', position: 'sticky', top: 0, zIndex: 2 };
  const numCell: React.CSSProperties  = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' as any };
  const numHCell: React.CSSProperties = { ...hCell, textAlign: 'right' };

  const sortArrow = (col: string) => (
    <span style={{ marginLeft: 3, fontSize: 9, opacity: sortCol === col ? 1 : 0.3 }}>
      {sortCol === col ? (sortAsc ? '▲' : '▼') : '↕'}
    </span>
  );
  const sortTh = (col: string, label: string, extra?: React.CSSProperties) => (
    <th onClick={() => toggleSort(col)} style={{ ...hCell, cursor: 'pointer', userSelect: 'none', ...extra }}>
      {label}{sortArrow(col)}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Reports
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Sales</h1>
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
        <select
          value={branchFilter ?? ''}
          onChange={e => handleBranchChange(e.target.value ? Number(e.target.value) : null)}
          style={{ height: 34, padding: '0 8px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: branchFilter ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', fontSize: 12, minWidth: 140, cursor: 'pointer' }}
        >
          <option value="">All Branches</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input
          placeholder="Search product or SKU…"
          value={filterText}
          onChange={e => { const v = e.target.value; setFilterText(v); setPage(1); load(1, v, filterBrand, filterSupplier, filterType, dateRange, pageSize, branchFilter); }}
          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterText ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, flex: '1 1 180px', minWidth: 160 }}
        />
        <input
          list="sbb-brand-list"
          placeholder="All Brands"
          value={filterBrand}
          onChange={e => { const v = e.target.value; setFilterBrand(v); setPage(1); load(1, filterText, v, filterSupplier, filterType, dateRange, pageSize, branchFilter); }}
          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterBrand ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, minWidth: 130 }}
        />
        <datalist id="sbb-brand-list">
          {brandsOptions.map(b => <option key={b} value={b} />)}
        </datalist>
        <input
          list="sbb-supplier-list"
          placeholder="All Suppliers"
          value={filterSupplier}
          onChange={e => { const v = e.target.value; setFilterSupplier(v); setPage(1); load(1, filterText, filterBrand, v, filterType, dateRange, pageSize, branchFilter); }}
          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterSupplier ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, minWidth: 130 }}
        />
        <datalist id="sbb-supplier-list">
          {suppliersOptions.map(s => <option key={s.id} value={s.name} />)}
        </datalist>
        <SBDatePicker value={dateRange} onChange={handleDateChange} />
        {!loading && total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
            {total.toLocaleString()} variant{total !== 1 ? 's' : ''}
          </span>
        )}
        {loading && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading…</span>}
        {(filterText || filterBrand || filterSupplier || filterType || branchFilter !== null) && (
          <button onClick={() => { setFilterText(''); setFilterBrand(''); setFilterSupplier(''); setFilterType(''); setBranchFilter(null); setPage(1); load(1, '', '', '', '', dateRange, pageSize, null); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--sv-red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--sv-red) 10%, transparent)', borderRadius: 6 }}>{error}</div>
      )}

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)', border: '1px solid var(--sv-etch)', borderRadius: 10, background: 'var(--sv-bg-1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...hCell, width: 44, textAlign: 'right' }}>#</th>
              {sortTh('product', 'Product', { position: 'sticky', left: 0, zIndex: 4, minWidth: 220 })}
              {sortTh('sku', 'SKU')}
              {sortTh('brand', 'Brand')}
              {sortTh('supplier', 'Supplier')}
              <th onClick={() => toggleSort('sales')} style={{ ...numHCell, cursor: 'pointer', userSelect: 'none', color: 'var(--sv-action)' }}>
                Sales ({dateRange.label}){sortArrow('sales')}
              </th>
              <th onClick={() => toggleSort('soh')} style={{ ...numHCell, cursor: 'pointer', userSelect: 'none' }}>
                Global SOH{sortArrow('soh')}
              </th>
              {locations.map(l => (
                <th key={l.id} onClick={() => toggleSort(`loc_${l.id}`)} style={{ ...numHCell, maxWidth: 100, whiteSpace: 'normal', lineHeight: 1.3, cursor: 'pointer', userSelect: 'none' }}>
                  {l.name}{sortArrow(`loc_${l.id}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7 + locations.length} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>Loading…</td></tr>
            )}
            {!loading && displayRows.length === 0 && (
              <tr><td colSpan={7 + locations.length} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>No results found.</td></tr>
            )}
            {!loading && displayRows.map((row, i) => {
              const salesQty = Number(row[salesKey] ?? 0);
              const locStockMap = new Map<number, any>(row.stock.map((s: any) => [s.location_id, s]));
              const rowBg = i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--sv-etch) 35%, transparent)';
              const rowNum = (page - 1) * pageSize + i + 1;
              return (
                <tr key={row.variant_id} style={{ background: rowBg }}>
                  <td style={{ ...numCell, color: 'var(--sv-text-dim)', fontSize: 11 }}>{rowNum}</td>
                  <td style={{ ...cellStyle, position: 'sticky', left: 0, zIndex: 1, background: rowBg, minWidth: 220 }}>
                    <div style={{ fontWeight: 500, color: 'var(--sv-text-strong)' }}>{row.product_name}</div>
                    {row.option_label && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 1 }}>{row.option_label}</div>}
                  </td>
                  <td style={{ ...cellStyle, color: 'var(--sv-text-dim)', fontFamily: 'monospace', fontSize: 12 }}>{row.sku || '—'}</td>
                  <td style={cellStyle}>{row.brand || '—'}</td>
                  <td style={cellStyle}>{row.supplier_name || '—'}</td>
                  <td style={{ ...numCell, color: salesQty > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)', fontWeight: salesQty > 0 ? 600 : 400 }}>
                    {salesQty.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                  </td>
                  <td style={{ ...numCell, fontWeight: row.global_soh > 0 ? 500 : 400, color: row.global_soh <= 0 ? 'var(--sv-text-dim)' : undefined }}>
                    {Number(row.global_soh).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                  </td>
                  {locations.map(l => {
                    const s = locStockMap.get(l.id);
                    const soh = s ? Number(s.soh) : 0;
                    return (
                      <td key={l.id} style={{ ...numCell, color: soh > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', opacity: soh > 0 ? 1 : 0.45 }}>
                        {soh > 0 ? soh.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => goPage(page - 1)} disabled={page <= 1 || loading}
              style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: 13, color: 'var(--sv-text-main)' }}
            >←</button>
            {pageRange().map((p, i) =>
              p === '...'
                ? <span key={`e${i}`} style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 4px' }}>…</span>
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
            >→</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sv-text-dim)' }}>
            <span>Page {page} of {totalPages} · {total.toLocaleString()} variants</span>
            <select
              value={pageSize} onChange={e => changePageSize(Number(e.target.value))}
              style={{ height: 28, padding: '0 6px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: 'pointer' }}
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
