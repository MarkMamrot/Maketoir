import React, { useCallback, useEffect, useState } from 'react';
import { SBDatePicker, SBDateRange } from './reportFilterHelpers';

function SortArrowIcon({ col, sortCol, sortAsc }: { col: string; sortCol: string; sortAsc: boolean }) {
  return (
    <span style={{ marginLeft: 3, fontSize: 9, opacity: sortCol === col ? 1 : 0.3 }}>
      {sortCol === col ? (sortAsc ? '\u25B2' : '\u25BC') : '\u2195'}
    </span>
  );
}

interface SalesByBranchViewProps {
  onBack: () => void;
  apiFetch: (url: string, opts?: RequestInit) => Promise<any>;
}

export function SalesByBranchView({ onBack, apiFetch }: SalesByBranchViewProps) {
  const [rows, setRows]             = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  const [totalQty, setTotalQty]     = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [locationTotals, setLocationTotals] = useState<any[]>([]);
  const [locations, setLocations]   = useState<{ id: number; name: string }[]>([]);
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

  const [sortCol, setSortCol] = useState<string>('sales_qty');
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
      setTotalQty(Number(data.totalQty ?? 0));
      setTotalAmount(Number(data.totalAmount ?? 0));
      setLocationTotals(data.locationTotals ?? []);
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

  const displayLocations = branchFilter === null
    ? locations
    : locations.filter(location => location.id === branchFilter);

  const formatAmount = (amount: number) => amount.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  };

  const displayRows = React.useMemo(() => {
    let r = [...rows];
    const dir = sortAsc ? 1 : -1;
    r.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortCol === 'sales_qty') { av = Number(a.sales_qty ?? 0); bv = Number(b.sales_qty ?? 0); }
      else if (sortCol === 'sales_amount') { av = Number(a.sales_amount ?? 0); bv = Number(b.sales_amount ?? 0); }
      else if (sortCol === 'product') { av = (a.product_name ?? '') + (a.option_label ?? ''); bv = (b.product_name ?? '') + (b.option_label ?? ''); }
      else if (sortCol === 'sku') { av = a.sku ?? ''; bv = b.sku ?? ''; }
      else if (sortCol === 'brand') { av = a.brand ?? ''; bv = b.brand ?? ''; }
      else if (sortCol === 'supplier') { av = a.supplier_name ?? ''; bv = b.supplier_name ?? ''; }
      else if (sortCol.startsWith('loc_qty_')) {
        const locationId = Number(sortCol.slice(8));
        av = Number(a.location_sales?.find((sale: any) => sale.location_id === locationId)?.sales_qty ?? 0);
        bv = Number(b.location_sales?.find((sale: any) => sale.location_id === locationId)?.sales_qty ?? 0);
      }
      else if (sortCol.startsWith('loc_amount_')) {
        const locationId = Number(sortCol.slice(11));
        av = Number(a.location_sales?.find((sale: any) => sale.location_id === locationId)?.sales_amount ?? 0);
        bv = Number(b.location_sales?.find((sale: any) => sale.location_id === locationId)?.sales_amount ?? 0);
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return r;
  }, [rows, sortCol, sortAsc]);

  const downloadCsv = () => {
    const locHeaders = displayLocations.flatMap(location => [`${location.name} Qty`, `${location.name} Sales Amount (inc. GST)`]);
    const headers = ['#', 'Product', 'Option', 'SKU', 'Brand', 'Supplier', `Sales Qty (${dateRange.label})`, 'Sales Amount (inc. GST)', ...locHeaders];
    const lines = [headers.map(h => `"${h}"`).join(',')];
    displayRows.forEach((row, i) => {
      const locCols = displayLocations.flatMap(location => {
        const sale = row.location_sales?.find((item: any) => item.location_id === location.id);
        return [String(Number(sale?.sales_qty ?? 0)), Number(sale?.sales_amount ?? 0).toFixed(2)];
      });
      lines.push([
        String((page - 1) * pageSize + i + 1),
        `"${(row.product_name || '').replace(/"/g, '""')}"`,
        `"${(row.option_label || '').replace(/"/g, '""')}"`,
        `"${(row.sku || '').replace(/"/g, '""')}"`,
        `"${(row.brand || '').replace(/"/g, '""')}"`,
        `"${(row.supplier_name || '').replace(/"/g, '""')}"`,
        String(Number(row.sales_qty ?? 0)), Number(row.sales_amount ?? 0).toFixed(2), ...locCols,
      ].join(','));
    });
    const totalLocationCols = displayLocations.flatMap(location => {
      const locationTotal = locationTotals.find(item => item.location_id === location.id);
      return [String(Number(locationTotal?.sales_qty ?? 0)), Number(locationTotal?.sales_amount ?? 0).toFixed(2)];
    });
    lines.push(['', '"TOTALS (ALL SELECTED)"', '', '', '', '', String(totalQty), totalAmount.toFixed(2), ...totalLocationCols].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sales-detail-${new Date().toLocaleDateString('sv-SE')}.csv`; a.click();
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
  const hCell: React.CSSProperties    = { ...cellStyle, height: 52, fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0, background: 'var(--sv-bg-2)', verticalAlign: 'middle', textAlign: 'center', position: 'sticky', top: 0, zIndex: 2 };
  const numCell: React.CSSProperties  = { ...cellStyle, textAlign: 'right' };
  const numHCell: React.CSSProperties = { ...hCell, textAlign: 'center' };
  const frozenDivider = '-4px 0 5px -4px color-mix(in srgb, var(--sv-text-dim) 35%, transparent)';

  const headingLabel = (primary: React.ReactNode, secondary: React.ReactNode, col?: string) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, lineHeight: 1.05, whiteSpace: 'normal' }}>
      <span>{primary}{col && <SortArrowIcon col={col} sortCol={sortCol} sortAsc={sortAsc} />}</span>
      <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--sv-text-dim)', opacity: 0.85 }}>{secondary}</span>
    </span>
  );

  const sortTh = (col: string, primary: React.ReactNode, secondary: React.ReactNode, extra?: React.CSSProperties) => (
    <th onClick={() => toggleSort(col)} style={{ ...hCell, cursor: 'pointer', userSelect: 'none', ...extra }}>
      {headingLabel(primary, secondary, col)}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Reports
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Sales Detail</h1>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ border: '1px solid var(--sv-etch)', borderRadius: 10, background: 'var(--sv-bg-1)', overflowX: 'auto', overflowY: 'visible', height: '100vh' }}>
          <table style={{ width: '100%', minWidth: 980 + displayLocations.length * 180, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--sv-bg-1)', boxShadow: '0 1px 0 0 var(--sv-etch)' }}>
                <th style={{ ...hCell, left: 0, zIndex: 4, width: 44, minWidth: 44, maxWidth: 44 }}>{headingLabel('Row', 'No.')}</th>
                {sortTh('product', 'Product', 'Name', { position: 'sticky', left: 44, zIndex: 4, minWidth: 220, boxShadow: frozenDivider })}
                {sortTh('sku', 'Product', 'SKU')}
                {sortTh('brand', 'Product', 'Brand')}
                {sortTh('supplier', 'Primary', 'Supplier')}
                <th onClick={() => toggleSort('sales_qty')} style={{ ...numHCell, cursor: 'pointer', userSelect: 'none', color: 'var(--sv-action)' }}>
                  {headingLabel('Sales Qty', dateRange.label, 'sales_qty')}
                </th>
                <th onClick={() => toggleSort('sales_amount')} style={{ ...numHCell, cursor: 'pointer', userSelect: 'none', color: 'var(--sv-action)' }}>
                  {headingLabel('Sales Amount', 'Inc. GST', 'sales_amount')}
                </th>
                {displayLocations.flatMap(location => [
                  <th key={`${location.id}-qty`} onClick={() => toggleSort(`loc_qty_${location.id}`)} style={{ ...numHCell, minWidth: 85, whiteSpace: 'normal', lineHeight: 1.3, cursor: 'pointer', userSelect: 'none' }}>
                    {headingLabel(location.name, 'Qty', `loc_qty_${location.id}`)}
                  </th>,
                  <th key={`${location.id}-amount`} onClick={() => toggleSort(`loc_amount_${location.id}`)} style={{ ...numHCell, minWidth: 115, whiteSpace: 'normal', lineHeight: 1.3, cursor: 'pointer', userSelect: 'none' }}>
                    {headingLabel(location.name, 'Amount · Inc. GST', `loc_amount_${location.id}`)}
                  </th>,
                ])}
              </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7 + displayLocations.length * 2} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>Loading…</td></tr>
                )}
                {!loading && displayRows.length === 0 && (
                  <tr><td colSpan={7 + displayLocations.length * 2} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>No results found.</td></tr>
                )}
                {!loading && displayRows.map((row, i) => {
                  const salesQty = Number(row.sales_qty ?? 0);
                  const locationSalesMap = new Map<number, any>((row.location_sales ?? []).map((sale: any) => [sale.location_id, sale]));
                  const rowBg = i % 2 === 0 ? 'var(--sv-bg-1)' : 'color-mix(in srgb, var(--sv-bg-1) 88%, var(--sv-etch))';
                  const rowNum = (page - 1) * pageSize + i + 1;
                  return (
                    <tr key={row.variant_id} style={{ background: rowBg }}>
                      <td style={{ ...numCell, position: 'sticky', left: 0, zIndex: 1, width: 44, minWidth: 44, maxWidth: 44, background: rowBg, color: 'var(--sv-text-dim)', fontSize: 11 }}>{rowNum}</td>
                      <td style={{ ...cellStyle, position: 'sticky', left: 44, zIndex: 1, background: rowBg, minWidth: 220, boxShadow: frozenDivider }}>
                        <div style={{ fontWeight: 500, color: 'var(--sv-text-strong)' }}>{row.product_name}</div>
                        {row.option_label && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 1 }}>{row.option_label}</div>}
                      </td>
                      <td style={{ ...cellStyle, color: 'var(--sv-text-dim)', fontFamily: 'monospace', fontSize: 12 }}>{row.sku || '—'}</td>
                      <td style={cellStyle}>{row.brand || '—'}</td>
                      <td style={cellStyle}>{row.supplier_name || '—'}</td>
                      <td style={{ ...numCell, color: salesQty > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)', fontWeight: salesQty > 0 ? 600 : 400 }}>
                        {salesQty.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                      </td>
                      <td style={{ ...numCell, fontWeight: row.sales_amount > 0 ? 500 : 400, color: row.sales_amount <= 0 ? 'var(--sv-text-dim)' : undefined }}>
                        {formatAmount(Number(row.sales_amount ?? 0))}
                      </td>
                      {displayLocations.flatMap(location => {
                        const sale = locationSalesMap.get(location.id);
                        const qty = Number(sale?.sales_qty ?? 0);
                        const amount = Number(sale?.sales_amount ?? 0);
                        return [
                          <td key={`${location.id}-qty`} style={{ ...numCell, color: qty ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>
                            {qty ? qty.toLocaleString('en-AU', { maximumFractionDigits: 2 }) : '—'}
                          </td>,
                          <td key={`${location.id}-amount`} style={{ ...numCell, color: amount ? 'var(--sv-text-main)' : 'var(--sv-text-dim)' }}>
                            {amount ? formatAmount(amount) : '—'}
                          </td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {!loading && (
                <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 3 }}>
                  <tr style={{ background: 'var(--sv-bg-2)', fontWeight: 700, boxShadow: '0 -1px 0 var(--sv-etch)' }}>
                    <td style={{ ...cellStyle, position: 'sticky', left: 0, zIndex: 4, width: 44, minWidth: 44, maxWidth: 44, background: 'var(--sv-bg-2)' }} />
                    <td style={{ ...cellStyle, position: 'sticky', left: 44, zIndex: 4, minWidth: 220, background: 'var(--sv-bg-2)', color: 'var(--sv-text-strong)', boxShadow: frozenDivider }}>
                      Totals (all selected variants)
                    </td>
                    <td colSpan={3} style={{ ...cellStyle, background: 'var(--sv-bg-2)' }} />
                    <td style={{ ...numCell, background: 'var(--sv-bg-2)' }}>{totalQty.toLocaleString('en-AU', { maximumFractionDigits: 2 })}</td>
                    <td style={{ ...numCell, background: 'var(--sv-bg-2)' }}>{formatAmount(totalAmount)}</td>
                    {displayLocations.flatMap(location => {
                      const locationTotal = locationTotals.find(item => item.location_id === location.id);
                      return [
                        <td key={`${location.id}-total-qty`} style={{ ...numCell, background: 'var(--sv-bg-2)' }}>{Number(locationTotal?.sales_qty ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 2 })}</td>,
                        <td key={`${location.id}-total-amount`} style={{ ...numCell, background: 'var(--sv-bg-2)' }}>{formatAmount(Number(locationTotal?.sales_amount ?? 0))}</td>,
                      ];
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 2 }}>
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
    </div>
  );
}
