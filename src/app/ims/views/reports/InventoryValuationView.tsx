'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ValuationResult } from '@/lib/ims/inventoryValuation';
import { inventoryValuationCsv, valuationCostLabel } from '@/lib/ims/inventoryValuation';
import { EMPTY_MULTI, hasMultiFilter, multiFilterParams, ReportMultiFilter, SBDatePicker, type MultiFilter } from './reportFilterHelpers';
import { ReportScrollTable } from './ReportScrollTable';

export function InventoryValuationView({ onBack, fmtCurrency }: {
  onBack: () => void;
  fmtCurrency: (value: number) => string;
}) {
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [businessToday, setBusinessToday] = useState('');
  const [asAt, setAsAt] = useState('');
  const [filters, setFilters] = useState<MultiFilter>(EMPTY_MULTI);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    const load = async () => {
      try {
        const params = new URLSearchParams(multiFilterParams(filters));
        if (asAt) params.set('asAt', asAt);
        const response = await fetch(`/api/ims/reports/inventory-valuation?${params}`, { signal: controller.signal });
        const data: ValuationResult | { success?: false; error?: string } = await response.json();
        if (current !== generation.current || controller.signal.aborted) return;
        if (!response.ok || data.success !== true) {
          throw new Error('error' in data && data.error ? data.error : 'Inventory valuation could not be loaded.');
        }
        setResult(data);
        setBusinessToday(data.business_today);
      } catch (failure) {
        if (!controller.signal.aborted && current === generation.current) {
          setError(failure instanceof Error ? failure.message : 'Inventory valuation could not be loaded.');
        }
      } finally {
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [asAt, filters]);

  const invalidate = () => {
    ++generation.current;
    setResult(null);
    setLoading(true);
    setError('');
  };
  const changeFilters = (value: MultiFilter) => { invalidate(); setFilters(value); };
  const rows = result?.data ?? [];
  const warnings = result?.warnings;
  const grandTotal = rows.reduce((sum, row) => sum + row.total_value, 0);
  const downloadCsv = () => {
    if (!result || loading || error) return;
    const blob = new Blob([inventoryValuationCsv(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inventory-valuation-${result.as_at}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const cell: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13 };
  const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const widths = [140, 300, 170, 150, 110, 150];
  const button: React.CSSProperties = { padding: '7px 12px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', cursor: 'pointer' };
  const selected = asAt || businessToday;
  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', padding: 0, marginBottom: 8, fontSize: 13 }}>← Back to Reports</button>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--sv-text-strong)', margin: 0 }}>Inventory Valuation</h2>
          {result && <div style={{ fontSize: 13, color: 'var(--sv-text-dim)', marginTop: 4 }}>
            {result.historical
              ? `Stock at the end of ${result.as_at} (${result.time_zone}), using historical costs where available.`
              : result.costing_method === 'fifo' ? 'Value of remaining FIFO cost layers.' : 'Stock on hand valued at current weighted-average cost.'}
          </div>}
        </div>
        <button onClick={downloadCsv} disabled={loading || !!error || !rows.length} style={button}>⬇ Export CSV</button>
      </div>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>As at date</span>
        <SBDatePicker
          asAt={{ today: businessToday }}
          value={{ kind: 'range', from: selected, to: selected, label: !asAt || selected === businessToday ? 'Today' : selected }}
          onChange={value => {
            if (value.kind !== 'range') return;
            const next = value.to === businessToday ? '' : value.to;
            if (next !== asAt) { invalidate(); setAsAt(next); }
          }}
        />
        <ReportMultiFilter filters={filters} onChange={changeFilters} />
        {hasMultiFilter(filters) && <button onClick={() => changeFilters(EMPTY_MULTI)} style={button}>Clear filters</button>}
        {loading && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading…</span>}
      </div>
      {error && <div role="alert" style={{ color: 'var(--sv-coral)', marginBottom: 16 }}>{error}</div>}
      {result?.reconciliation.status === 'mismatch' && <div role="alert" style={{ color: 'var(--sv-coral)', marginBottom: 16 }}>
        FIFO layer quantities do not match stock on hand for {result.reconciliation.mismatched_sku_count.toLocaleString()} SKU(s). Resolve the discrepancy before relying on this valuation.
      </div>}
      {warnings && <div style={{ fontSize: 13, color: 'var(--sv-text-dim)', marginBottom: 16 }}>
        {warnings.current_cost_sku_count > 0 && <div>{warnings.current_cost_sku_count.toLocaleString()} SKU(s) use today&apos;s costs because reliable historical costs are unavailable. These values are estimates.</div>}
        {warnings.uncosted_sku_count > 0 && <div role="alert" style={{ color: 'var(--sv-coral)' }}>{warnings.uncosted_sku_count.toLocaleString()} SKU(s) have no available cost and are excluded from the monetary total. The valuation is incomplete.</div>}
        {warnings.inferred_opening_sku_count > 0 && <div>{warnings.inferred_opening_sku_count.toLocaleString()} SKU(s) use inferred opening stock. Quantities depend on the available movement history; the original opening date may be unknown.</div>}
        {warnings.incomplete_history_sku_count > 0 && <div role="alert" style={{ color: 'var(--sv-coral)' }}>{warnings.incomplete_history_sku_count.toLocaleString()} SKU(s) have gaps or stock changes that do not reconcile with recorded movements. Check Stock History before relying on the total.</div>}
        {warnings.negative_position_count > 0 && <div role="alert" style={{ color: 'var(--sv-coral)' }}>{warnings.negative_position_count.toLocaleString()} location/variant position(s) have negative historical stock. Non-positive SKU totals are not counted as inventory assets.</div>}
      </div>}
      <div style={{ background: 'var(--sv-bg-1)', borderRadius: 8, border: '1px solid var(--sv-etch)', padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Total Inventory Value{result ? ` — ${result.as_at}` : ''}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{result ? fmtCurrency(grandTotal) : '—'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Unique SKUs Counted</div>
          <div style={{ fontSize: 16 }}>{result ? rows.length.toLocaleString() : '—'}</div>
        </div>
      </div>
      <ReportScrollTable
        ariaLabel="Inventory valuation table. Use arrow keys to scroll."
        bodyClassName="inventory-valuation-table-scroll"
        tableWidth={widths.reduce((sum, width) => sum + width, 0)}
        renderColGroup={() => <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>}
        borderRadius={8}
        frozenColumnWidths={[140, 300]}
        headerRows={<tr>
          {['SKU', 'Product Name', 'Brand', result?.costing_method === 'fifo' ? 'FIFO Unit Cost' : 'Average Unit Cost', 'SOH', 'Total Value'].map((label, index) =>
            <th key={label} style={{ ...(index < 3 ? cell : numericCell), textAlign: index < 3 ? 'left' : 'right', fontWeight: 600, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{label}</th>)}
        </tr>}
      >
        <tbody>
          {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center' }}>Loading...</td></tr>}
          {!loading && rows.map((row, index) => <tr key={row.variant_id} style={{ background: index % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--sv-etch) 35%, transparent)' }}>
            <td style={{ ...cell, fontFamily: 'monospace' }}>{row.sku}</td>
            <td style={{ ...cell, fontWeight: 500 }}>{row.name}</td>
            <td style={cell}>{row.brand || '—'}</td>
            <td style={numericCell}>
              {row.cost_source === 'uncosted' ? '—' : fmtCurrency(row.cost)}
              {result?.historical && <div style={{ fontSize: 10, color: 'var(--sv-text-dim)' }}>{valuationCostLabel(row.cost_source)}</div>}
            </td>
            <td style={numericCell}>{row.soh.toLocaleString()}{row.inferred_opening && <span title="Inferred opening stock"> *</span>}</td>
            <td style={{ ...numericCell, fontWeight: 600 }}>{row.cost_source === 'uncosted' ? '—' : fmtCurrency(row.total_value)}</td>
          </tr>)}
        </tbody>
      </ReportScrollTable>
    </div>
  );
}
