"use client";

import { useEffect, useState } from 'react';
import { EMPTY_MULTI, hasMultiFilter, multiFilterParams, ReportMultiFilter, SBDatePicker, type MultiFilter, type SBDateRange } from './reportFilterHelpers';
import { ReportScrollTable } from './ReportScrollTable';
import { productProfitabilityCsv, type ProfitabilityRow } from '@/lib/ims/productProfitability';
import type { summarise } from '@/lib/ims/cogsTraceability/domain';

interface ProfitabilityReport {
  success: true;
  data: ProfitabilityRow[];
  total: number;
  from: string;
  to: string;
  summary: ReturnType<typeof summarise>;
  excludedNonProductRecords: number;
}

export function ProductProfitabilityView({ onBack, fmtCurrency }: {
  onBack: () => void;
  fmtCurrency: (amount: number) => string;
}) {
  const [report, setReport] = useState<ProfitabilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<MultiFilter>(EMPTY_MULTI);
  const [dateRange, setDateRange] = useState<SBDateRange>({ kind: 'window', window: 365, label: '12 Months' });
  const [page, setPage] = useState(1);
  const pageSize = 100;

  useEffect(() => {
    let current = true;
    setLoading(true);
    setReport(null);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...multiFilterParams(filters) });
    if (dateRange.kind === 'window') params.set('window', String(dateRange.window));
    else { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    void (async () => {
      try {
        const response = await fetch(`/api/ims/reports/product-margin?${params}`);
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error ?? 'Failed to load Product Profitability.');
        if (current) setReport(data);
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message : 'Failed to load Product Profitability.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [filters, dateRange, page]);

  const money = (amount: number | null | undefined) => amount == null ? 'Unavailable' : fmtCurrency(amount);
  const percent = (amount: number | null | undefined) => amount == null ? 'Unavailable' : `${amount.toFixed(1)}%`;
  const totalPages = Math.ceil((report?.total ?? 0) / pageSize) || 1;
  const widths = [140, 300, 170, 110, 150, 150, 150, 110, 240];
  const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13 };
  const number: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const control: React.CSSProperties = { padding: '7px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer' };
  const download = () => {
    if (!report || loading || error) return;
    const url = URL.createObjectURL(new Blob([productProfitabilityCsv(report.data)], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `product-profitability-${report.from}-${report.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
      <button onClick={onBack} style={control}>Reports</button>
      <h1 style={{ fontSize: 20, margin: 0, flex: 1 }}>Product Profitability</h1>
      <button onClick={download} disabled={loading || !!error || !report?.data.length} style={control}>Export CSV</button>
    </div>
    <p style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>
      Recorded product sales and returns, net of discounts, in AUD excluding GST. Costs come from captured stock movements, not current catalogue prices.
      Sale/order dates determine the period; an unfulfilled order can have revenue but incomplete COGS.
    </p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <ReportMultiFilter filters={filters} onChange={value => { setFilters(value); setPage(1); }} />
      <SBDatePicker value={dateRange} onChange={value => { setDateRange(value); setPage(1); }} />
      {hasMultiFilter(filters) && <button onClick={() => { setFilters(EMPTY_MULTI); setPage(1); }} style={control}>Clear filters</button>}
    </div>
    {error && <p role="alert" style={{ color: 'var(--sv-coral)' }}>{error}</p>}
    {loading && <p role="status">Loading Product Profitability...</p>}
    {report && !loading && <>
      <p style={{ fontSize: 12 }}>All matching products: {report.total.toLocaleString()} results | {report.from} to {report.to}</p>
      {(report.summary.missingCosts > 0 || report.summary.missingRevenue > 0) && <p role="status" style={{ color: 'var(--sv-amber)', fontSize: 13 }}>
        Incomplete evidence: {report.summary.missingCosts} records lack complete captured costs; {report.summary.missingRevenue} lack reliable tax/currency revenue.
        Affected product and full-result totals are unavailable, not zero. Narrow the period or inspect Sales &amp; COGS Traceability.
      </p>}
      {report.excludedNonProductRecords > 0 && <p style={{ fontSize: 12 }}>
        {report.excludedNonProductRecords} non-product records (including document freight/rounding adjustments) are excluded from this product report.
      </p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 12 }}>
        {[
          ['Net Revenue (AUD ex GST)', money(report.summary.netSales)],
          ['Captured COGS (AUD)', money(report.summary.cogs)],
          ['Gross Profit (AUD ex GST)', money(report.summary.gp)],
          ['Blended Margin', percent(report.summary.gpPercent)],
        ].map(([label, value]) => <div key={label} style={{ padding: 14, border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
        </div>)}
      </div>
    </>}
    <ReportScrollTable ariaLabel="Product profitability table. Use arrow keys to scroll."
      bodyClassName="product-margin-table-scroll" tableWidth={widths.reduce((sum, width) => sum + width, 0)}
      renderColGroup={() => <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>}
      frozenColumnWidths={[140, 300]}
      headerRows={<tr>{['SKU', 'Product Name', 'Brand (current)', 'Net Qty', 'Net Rev ex GST', 'Captured COGS', 'Gross Profit ex GST', 'Margin %', 'Evidence'].map((label, index) =>
        <th key={label} style={{ ...(index >= 3 && index <= 7 ? number : cell), fontWeight: 600, background: 'var(--sv-bg-2)' }}>{label}</th>)}</tr>}>
      <tbody>
        {!loading && !error && !report?.data.length && <tr><td colSpan={9} style={cell}>No results found.</td></tr>}
        {!loading && report?.data.map(row => <tr key={row.variantId ?? row.sku}>
          <td style={cell}>{row.sku || '-'}</td><td style={{ ...cell, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name}>{row.name}</td>
          <td style={cell}>{row.brand || '-'}</td><td style={number}>{row.qty.toLocaleString()}</td>
          <td style={number}>{money(row.rev)}</td><td style={number}>{money(row.cogs)}</td>
          <td style={number}>{money(row.profit)}</td><td style={number}>{percent(row.margin)}</td>
          <td style={cell}>{row.missingCosts || row.missingRevenue
            ? `Incomplete: ${row.missingCosts} cost / ${row.missingRevenue} revenue` : 'Complete'}</td>
        </tr>)}
      </tbody>
    </ReportScrollTable>
    {report && !loading && totalPages > 1 && <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
      <button onClick={() => setPage(value => value - 1)} disabled={page <= 1} style={control}>Previous</button>
      <span>Page {page} of {totalPages} | 100 per page</span>
      <button onClick={() => setPage(value => value + 1)} disabled={page >= totalPages} style={control}>Next</button>
    </div>}
  </div>;
}
