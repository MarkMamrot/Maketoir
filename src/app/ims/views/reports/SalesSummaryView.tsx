'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { SALES_SUMMARY_DIMENSIONS, salesSummaryDimensionLabel, type SalesSummaryDimension } from '@/lib/ims/salesSummary';
import { SBDatePicker, type SBDateRange } from './reportFilterHelpers';
import { ReportScrollTable } from './ReportScrollTable';

interface SalesSummaryViewProps {
  onBack: () => void;
  apiFetch: (url: string) => Promise<any>;
}

interface LocationOption { id: number; name: string }

const DIMENSION_FIELDS: Record<SalesSummaryDimension, string> = {
  location: 'location_name',
  supplier: 'supplier_name',
  brand: 'brand',
  product_type: 'product_type',
  day_of_week: 'day_of_week_label',
  hour_of_day: 'hour_of_day_label',
};

const money = (value: number) => Number(value ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const quantity = (value: number) => Number(value ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 2 });
const percent = (value: number | null) => value == null ? '—' : `${Number(value).toFixed(1)}%`;

export function SalesSummaryView({ onBack, apiFetch }: SalesSummaryViewProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [dimensions, setDimensions] = useState<SalesSummaryDimension[]>(['location']);
  const [dateRange, setDateRange] = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const buildParams = useCallback((requestedPage: number, requestedPageSize = pageSize) => {
    const params = new URLSearchParams({
      groupBy: dimensions.join(','),
      page: String(requestedPage),
      pageSize: String(requestedPageSize),
    });
    if (selectedLocationIds.length > 0 && selectedLocationIds.length < locations.length) {
      params.set('locationIds', selectedLocationIds.join(','));
    }
    if (dateRange.kind === 'window') params.set('window', String(dateRange.window));
    else {
      params.set('from', dateRange.from);
      params.set('to', dateRange.to);
    }
    return params;
  }, [dateRange, dimensions, locations.length, pageSize, selectedLocationIds]);

  const load = useCallback(async (requestedPage: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/api/ims/reports/sales-summary?${buildParams(requestedPage)}`);
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
      setTotal(Number(data.total ?? 0));
      setLocations(data.locations ?? []);
      setPage(requestedPage);
    } catch (reason: any) {
      setError(reason?.message ?? 'Failed to load Sales - Summary');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, buildParams]);

  useEffect(() => { load(1); }, [load]);

  const setFirstDimension = (dimension: SalesSummaryDimension) => {
    setDimensions(current => [dimension, ...current.slice(1).filter(item => item !== dimension)]);
    setPage(1);
  };

  const setSecondDimension = (dimension: SalesSummaryDimension | '') => {
    setDimensions(current => dimension ? [current[0], dimension] : [current[0]]);
    setPage(1);
  };

  const toggleLocation = (id: number) => {
    setSelectedLocationIds(current => {
      const effective = current.length === 0 ? locations.map(location => location.id) : current;
      const next = effective.includes(id) ? effective.filter(value => value !== id) : [...effective, id];
      return next.length === locations.length ? [] : next;
    });
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const exportRows: any[] = [];
      const first = await apiFetch(`/api/ims/reports/sales-summary?${buildParams(1, 200)}`);
      exportRows.push(...(first.rows ?? []));
      const pages = Math.ceil(Number(first.total ?? 0) / 200);
      for (let exportPage = 2; exportPage <= pages; exportPage += 1) {
        const result = await apiFetch(`/api/ims/reports/sales-summary?${buildParams(exportPage, 200)}`);
        exportRows.push(...(result.rows ?? []));
      }
      const headers = [
        ...dimensions.map(salesSummaryDimensionLabel),
        'Sales Qty', 'Sales Amount (Inc. GST)', 'COGS (Ex. GST, Attached)',
        'GP (Ex. GST)', 'GP %', 'Current SOH', 'COGS Coverage %',
      ];
      const values = exportRows.map(row => [
        ...dimensions.map(dimension => row[DIMENSION_FIELDS[dimension]] ?? 'Unknown'),
        row.sales_qty, row.sales_amount, row.attached_cogs, row.grossProfit,
        row.grossProfitPercent ?? '', row.current_soh, row.cogsCoveragePercent,
      ]);
      const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const blob = new Blob([[headers, ...values].map(line => line.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sales-summary-${new Date().toLocaleDateString('sv-SE')}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (reason: any) {
      setError(reason?.message ?? 'Failed to export Sales - Summary');
    } finally {
      setExporting(false);
    }
  };

  const allLocations = selectedLocationIds.length === 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const control: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12 };
  const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', whiteSpace: 'nowrap', fontSize: 13 };
  const numericCell: React.CSSProperties = { ...cell, textAlign: 'right' };
  const heading: React.CSSProperties = { ...cell, height: 52, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 11, textAlign: 'center', textTransform: 'uppercase', verticalAlign: 'middle' };
  const headingLabel = (primary: string, secondary?: string) => <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, lineHeight: 1.05 }}><span>{primary}</span>{secondary && <span style={{ fontSize: 9, fontWeight: 500, textTransform: 'none' }}>{secondary}</span>}</span>;
  const dimensionWidths = dimensions.map(dimension => dimension === 'location' ? 150 : 125);
  const metricWidths = [110, 150, 160, 130, 115, 145, 150];
  const tableWidth = [...dimensionWidths, ...metricWidths].reduce((sum, width) => sum + width, 0);
  const renderColGroup = () => <colgroup>{[...dimensionWidths, ...metricWidths].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;

  return <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
      <button onClick={onBack} title="Back to reports" style={{ ...control, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><ArrowLeft size={14} /> Reports</button>
      <h1 style={{ margin: 0, flex: 1, fontSize: 20, color: 'var(--sv-text-strong)' }}>Sales - Summary</h1>
      <button onClick={() => load(page)} title="Refresh report" style={{ ...control, width: 34, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><RefreshCw size={14} /></button>
      <button onClick={exportCsv} disabled={exporting || total === 0} style={{ ...control, display: 'flex', alignItems: 'center', gap: 6, cursor: total === 0 ? 'not-allowed' : 'pointer', opacity: total === 0 ? 0.5 : 1 }}><Download size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}</button>
    </div>

    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 0', marginBottom: 10, borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)' }}>
      <SBDatePicker value={dateRange} onChange={value => { setDateRange(value); setPage(1); }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sv-text-dim)', fontSize: 11 }}>
        First heading
        <select value={dimensions[0]} onChange={event => setFirstDimension(event.target.value as SalesSummaryDimension)} style={{ ...control, cursor: 'pointer' }}>
          {SALES_SUMMARY_DIMENSIONS.map(dimension => <option key={dimension} value={dimension}>{salesSummaryDimensionLabel(dimension)}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sv-text-dim)', fontSize: 11 }}>
        Second heading
        <select value={dimensions[1] ?? ''} onChange={event => setSecondDimension(event.target.value as SalesSummaryDimension | '')} style={{ ...control, cursor: 'pointer' }}>
          <option value="">None</option>
          {SALES_SUMMARY_DIMENSIONS.filter(dimension => dimension !== dimensions[0]).map(dimension => <option key={dimension} value={dimension}>{salesSummaryDimensionLabel(dimension)}</option>)}
        </select>
      </label>
      <details style={{ position: 'relative' }}>
        <summary style={{ ...control, display: 'flex', alignItems: 'center', cursor: 'pointer', listStyle: 'none' }}>{allLocations ? 'All Locations' : `${selectedLocationIds.length} Locations`}</summary>
        <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 20, minWidth: 210, maxHeight: 300, overflowY: 'auto', padding: 8, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', boxShadow: '0 8px 22px rgba(0,0,0,.18)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}><input type="checkbox" checked={allLocations} onChange={() => setSelectedLocationIds([])} />ALL</label>
          {locations.map(location => <label key={location.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px', fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={allLocations || selectedLocationIds.includes(location.id)} onChange={() => toggleLocation(location.id)} />{location.name}</label>)}
        </div>
      </details>
    </div>

    {error && <div style={{ marginBottom: 12, color: 'var(--sv-red)', fontSize: 13 }}>{error}</div>}
    <ReportScrollTable
      ariaLabel="Sales summary table. Use arrow keys to scroll."
      bodyClassName="sales-summary-table-scroll"
      tableWidth={tableWidth}
      renderColGroup={renderColGroup}
      borderRadius={7}
      headerRows={<tr>
          {dimensions.map((dimension, index) => <th key={dimension} style={{ ...heading, textAlign: 'left', minWidth: dimension === 'location' ? 150 : 125, ...(index === 0 ? { position: 'sticky', left: 0, zIndex: 4, boxShadow: '-4px 0 5px -4px color-mix(in srgb, var(--sv-text-dim) 35%, transparent)' } : {}) }}>{headingLabel(salesSummaryDimensionLabel(dimension), 'Group')}</th>)}
          <th style={heading}>{headingLabel('Sales Qty', dateRange.label)}</th>
          <th style={heading}>{headingLabel('Sales Amount', 'Inc. GST')}</th>
          <th style={heading}>{headingLabel('COGS', 'Ex. GST · Attached')}</th>
          <th style={heading}>{headingLabel('GP', 'Ex. GST')}</th>
          <th style={heading}>{headingLabel('GP %', 'Covered Sales')}</th>
          <th style={heading}>{headingLabel('Current SOH', allLocations ? 'All Locations' : 'Selected Locations')}</th>
          <th style={heading}>{headingLabel('COGS Coverage', 'Sales Amount')}</th>
        </tr>}
      >
        <tbody>
          {loading ? <tr><td colSpan={dimensions.length + 7} style={{ padding: 40, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading...</td></tr> : rows.length === 0 ? <tr><td colSpan={dimensions.length + 7} style={{ padding: 40, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No sales match this selection.</td></tr> : rows.map((row, index) => <tr key={`${page}-${index}`} style={{ background: index % 2 ? 'var(--sv-bg-1)' : 'var(--sv-bg-0)' }}>
            {dimensions.map((dimension, dimensionIndex) => <td key={dimension} style={{ ...cell, ...(dimensionIndex === 0 ? { position: 'sticky', left: 0, zIndex: 1, background: index % 2 ? 'var(--sv-bg-1)' : 'var(--sv-bg-0)', boxShadow: '-4px 0 5px -4px color-mix(in srgb, var(--sv-text-dim) 35%, transparent)' } : {}) }}>{row[DIMENSION_FIELDS[dimension]] ?? 'Unknown'}</td>)}
            <td style={numericCell}>{quantity(row.sales_qty)}</td>
            <td style={numericCell}>{money(row.sales_amount)}</td>
            <td style={numericCell}>{money(row.attached_cogs)}</td>
            <td style={numericCell}>{Number(row.covered_amount) > 0 ? money(row.grossProfit) : '—'}</td>
            <td style={numericCell}>{percent(row.grossProfitPercent)}</td>
            <td style={numericCell}>{quantity(row.current_soh)}</td>
            <td style={{ ...numericCell, color: Number(row.cogsCoveragePercent) < 100 ? 'var(--sv-amber)' : 'var(--sv-text-main)' }}>{percent(row.cogsCoveragePercent)}</td>
          </tr>)}
        </tbody>
        {!loading && totals && <tfoot><tr style={{ background: 'var(--sv-bg-2)', fontWeight: 700, boxShadow: '0 -1px 0 var(--sv-etch)' }}>
          <td colSpan={dimensions.length} style={cell}>TOTALS (ALL SELECTED)</td>
          <td style={numericCell}>{quantity(totals.sales_qty)}</td><td style={numericCell}>{money(totals.sales_amount)}</td><td style={numericCell}>{money(totals.attached_cogs)}</td><td style={numericCell}>{Number(totals.covered_amount) > 0 ? money(totals.grossProfit) : '—'}</td><td style={numericCell}>{percent(totals.grossProfitPercent)}</td><td style={numericCell}>{quantity(totals.current_soh)}</td><td style={numericCell}>{percent(totals.cogsCoveragePercent)}</td>
        </tr></tfoot>}
    </ReportScrollTable>

    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--sv-text-dim)' }}>
      <span>Page {page} of {totalPages} · {total.toLocaleString()} groups</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} style={control}>Previous</button>
        <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} style={control}>Next</button>
        <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }} style={control}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select>
      </div>
    </div>
  </div>;
}