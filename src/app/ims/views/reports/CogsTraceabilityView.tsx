'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, ExternalLink, Eye, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { fields, metrics, type Basis, type Field, type Filter, type ReportRow } from '@/lib/ims/cogsTraceability/domain';
import type { Allocation } from '@/lib/ims/cogsTraceability/projection';
import type { buildReport } from '@/lib/ims/cogsTraceability/service';
import { ReportScrollTable } from './ReportScrollTable';
import { SBDatePicker, type SBDateRange } from './reportFilterHelpers';

type Report = Omit<Awaited<ReturnType<typeof buildReport>>, 'exportRows'>;
const defaultColumns: Field[] = ['orderRef', 'sku', 'movementDate', 'customer', 'channel', 'warehouse', 'qty', 'sales', 'discount', 'netSales', 'cogs', 'gp', 'gpPercent', 'tax', 'quality'];
const financialColumns: Field[] = ['qty', 'sales', 'discount', 'netSales', 'cogs', 'gp', 'gpPercent'];
const filterFields: Field[] = ['channel', 'warehouse', 'sku', 'brand', 'customer', 'orderRef', 'orderStatus'];
const groupFields: Field[] = ['channel', 'channelInstance', 'warehouse', 'brand', 'sku', 'customer', 'batch'];
const amountFields: Field[] = ['sales', 'discount', 'netSales', 'cogs', 'knownCogs', 'gp', 'tax'];
const control: React.CSSProperties = { border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', height: 34, fontSize: 12, padding: '0 8px', maxWidth: '100%', boxSizing: 'border-box' };
const iconButton: React.CSSProperties = { ...control, width: 34, height: 34, padding: 0, display: 'inline-grid', placeItems: 'center', flexShrink: 0, cursor: 'pointer' };
const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13, verticalAlign: 'middle', overflowWrap: 'anywhere', color: 'var(--sv-text-main)' };

function display(field: Field, value: unknown) {
  if (value == null || value === '') return 'Not recorded';
  if (typeof value === 'number') {
    if (amountFields.includes(field)) return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
    return value.toLocaleString('en-AU', { minimumFractionDigits: metrics.includes(field) && field !== 'qty' ? 2 : 0, maximumFractionDigits: field === 'qty' ? 4 : metrics.includes(field) ? 2 : 0 }) + (field === 'gpPercent' ? '%' : '');
  }
  return String(value);
}

function cogsValue(row: Pick<ReportRow, 'cogs' | 'knownCogs' | 'costedRecords'>) {
  const partial = row.cogs == null && row.knownCogs != null && (row.costedRecords ?? 1) > 0;
  return <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
    {display('cogs', partial ? row.knownCogs : row.cogs)}
    {partial && <span title="Captured costs only; some records have missing costs or incomplete fulfilment" style={{ fontSize: 11, fontWeight: 500, color: 'var(--sv-text-dim)' }}>Partial</span>}
  </span>;
}

export function CogsTraceabilityView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'detail' | 'summary' | 'reconciliation'>('summary');
  const [basis, setBasis] = useState<Basis>('movement');
  const [range, setRange] = useState<SBDateRange>({ kind: 'window', window: 30, label: '30 Days' });
  const [filters, setFilters] = useState<Filter[]>([]);
  const [groups, setGroups] = useState<Field[]>(['channel']);
  const [columns, setColumns] = useState<Field[]>(defaultColumns);
  const [columnPicker, setColumnPicker] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Field>('movementDate');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [data, setData] = useState<Report | null>(null);
  const [loadedQuery, setLoadedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams({ basis, page: String(page), pageSize: '50', sort, direction, filters: JSON.stringify(filters.filter(filter => filter.value.trim() !== '')), groups: tab === 'summary' ? groups.join(',') : '' });
  if (range.kind === 'range') { params.set('from', range.from); params.set('to', range.to); }
  else params.set('window', String(range.window));
  const queryString = params.toString();
  const reportPending = loading || loadedQuery !== queryString;

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setSelected(null);
    fetch(`/api/ims/reports/cogs-traceability?${queryString}`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || 'Report could not be loaded.'); return body as Report; })
      .then(body => { if (!abort.signal.aborted) { setData(body); setLoadedQuery(queryString); } })
      .catch(loadError => { if (!abort.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Report could not be loaded.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [queryString, revision]);

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/reports/cogs-traceability/export?${queryString}`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Export failed.'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `sales-cogs-${basis}-${data?.from ?? ''}-${data?.to ?? ''}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Export failed.'); }
    finally { setExporting(false); }
  };

  const summaryTotals = [...new Set([...financialColumns, ...groups.filter(field => metrics.includes(field)), 'quality' as Field])];
  const visibleColumns = tab === 'summary' ? [...groups, ...summaryTotals] : columns;
  const widths = visibleColumns.map(field => field === 'cogs' ? 170 : metrics.includes(field) ? 130 : field === 'description' || field === 'quality' ? 280 : 190);
  const tableWidth = widths.reduce((total, width) => total + width, 0) + (tab === 'detail' ? 54 : 0);
  const columnGroup = () => <colgroup>{visibleColumns.map((field, index) => <col key={`${field}:${index}`} style={{ width: widths[index] }} />)}{tab === 'detail' && <col style={{ width: 54 }} />}</colgroup>;
  const rowValue = (row: ReportRow, field: Field, index: number) => tab === 'summary' && index < groups.length ? JSON.parse(row.id)[index] : row[field];
  const selectedMovementIds = selected ? typeof selected.movementId === 'number' ? [selected.movementId] : String(selected.movementId ?? '').split(',').map(Number) : [];
  const selectedAllocations = data?.allocations.filter(allocation => selectedMovementIds.includes(allocation.movementId)) ?? [];
  const changeFilter = (index: number, patch: Partial<Filter>) => { setFilters(previous => previous.map((filter, filterIndex) => filterIndex === index ? { ...filter, ...patch } : filter)); setPage(1); };

  return <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
      <button title="Back to reports" onClick={onBack} style={{ ...control, color: 'var(--sv-text-dim)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><ArrowLeft size={13} />Reports</button>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', flex: '1 1 240px' }}>Sales &amp; COGS Traceability</h1>
      <div style={{ display: 'flex', gap: 8 }}><button title="Refresh report" aria-label="Refresh report" style={iconButton} disabled={reportPending && !error} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></button><button title="Export all matching rows and fields as CSV" style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} disabled={exporting || reportPending || !data} onClick={() => void exportCsv()}><Download size={14} />{exporting ? 'Exporting...' : 'Export CSV'}</button></div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--sv-etch)', borderBottom: '1px solid var(--sv-etch)' }}>
      <div role="group" aria-label="Report date basis" style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{(['movement', 'sale'] as const).map(option => <button key={option} aria-pressed={basis === option} onClick={() => { setBasis(option); setSort(option === 'movement' ? 'movementDate' : 'saleDate'); setPage(1); }} style={{ ...control, background: basis === option ? 'var(--sv-action)' : 'var(--sv-bg-0)', color: basis === option ? '#fff' : 'var(--sv-text-main)', cursor: 'pointer' }}>{option === 'movement' ? 'Stock movement date' : 'Invoice / sale date'}</button>)}</div>
      <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>AUD, excluding GST</span>
      <div data-testid="cogs-date-filter" style={{ marginLeft: 'auto', flexShrink: 0 }}><SBDatePicker value={range} onChange={value => { setRange(value); setPage(1); }} /></div>
    </div>
    <div role="tablist" aria-label="Sales and COGS views" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '12px 0' }}>{(['detail', 'summary', 'reconciliation'] as const).map(option => <button key={option} role="tab" aria-selected={tab === option} onClick={() => { setTab(option); setPage(1); }} style={{ ...control, borderColor: tab === option ? 'var(--sv-action)' : 'var(--sv-etch)', background: tab === option ? 'color-mix(in srgb, var(--sv-action) 8%, var(--sv-bg-0))' : 'var(--sv-bg-0)', color: tab === option ? 'var(--sv-action)' : 'var(--sv-text-dim)', fontWeight: 600, cursor: 'pointer' }}>{option[0].toUpperCase() + option.slice(1)}</button>)}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
      {tab === 'summary' && <><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)' }}>Group by</span>{groups.map((group, index) => <div key={index} style={{ display: 'flex', gap: 4 }}><select aria-label={`Grouping ${index + 1}`} style={control} value={group} onChange={event => { const next = groups.slice(); next[index] = event.target.value as Field; setGroups([...new Set(next)]); setPage(1); }}>{groupFields.map(field => <option key={field} value={field}>{fields[field]}</option>)}</select>{groups.length > 1 && <button title="Remove grouping" aria-label="Remove grouping" style={iconButton} onClick={() => { setGroups(groups.filter((_, groupIndex) => groupIndex !== index)); setPage(1); }}><X size={14} /></button>}</div>)}<button title="Add grouping" aria-label="Add grouping" disabled={groups.length >= 4} style={iconButton} onClick={() => { setGroups([...groups, groupFields.find(field => !groups.includes(field))!]); setPage(1); }}><Plus size={15} /></button></>}
      <button title="Add field filter" style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} disabled={filters.length >= filterFields.length} onClick={() => { setFilters([...filters, { field: filterFields.find(field => !filters.some(filter => filter.field === field)) ?? 'channel', operator: 'contains', value: '' }]); setPage(1); }}><Plus size={14} />Filter</button>
      {tab === 'detail' && <button title="Choose columns" aria-expanded={columnPicker} style={iconButton} onClick={() => setColumnPicker(value => !value)}><Columns3 size={16} /></button>}
    </div>
    {filters.map((filter, index) => <div key={index} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}><select aria-label={`Filter field ${index + 1}`} style={control} value={filter.field} onChange={event => changeFilter(index, { field: event.target.value as Field })}>{filterFields.map(field => <option key={field} value={field}>{fields[field]}</option>)}</select><select aria-label={`Filter operator ${index + 1}`} style={control} value={filter.operator} onChange={event => changeFilter(index, { operator: event.target.value as Filter['operator'] })}><option value="contains">Contains</option><option value="equals">Equals</option></select><input aria-label={`Filter value ${index + 1}`} type="text" placeholder={filter.field === 'sku' ? 'Product SKU' : fields[filter.field]} style={{ ...control, flex: '0 1 280px', minWidth: 0 }} value={filter.value} onChange={event => changeFilter(index, { value: event.target.value })} /><button title="Remove filter" aria-label="Remove filter" style={iconButton} onClick={() => { setFilters(filters.filter((_, filterIndex) => filterIndex !== index)); setPage(1); }}><Trash2 size={14} /></button></div>)}
    {columnPicker && tab === 'detail' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, padding: '12px 0', borderBottom: '1px solid var(--sv-etch)', marginBottom: 12 }}>{Object.entries(fields).map(([field, label]) => <label key={field} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={columns.includes(field as Field)} disabled={columns.length === 1 && columns.includes(field as Field)} onChange={event => setColumns(event.target.checked ? [...columns, field as Field] : columns.filter(column => column !== field))} />{label}</label>)}</div>}
    {error && <div role="alert" style={{ padding: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 12 }}>{error}</div>}
    {reportPending && !error ? <div role="status" style={{ padding: 30, color: 'var(--sv-text-dim)' }}>Loading report...</div> : !error && data && <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', borderBottom: '1px solid var(--sv-etch)', padding: '10px 0 14px', marginBottom: 14 }}>
        {(['netSales', 'cogs', 'gp', 'gpPercent'] as const).map(field => <div key={field}><div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginBottom: 4 }}>{field === 'cogs' && data.summary.cogs == null && data.summary.costedRecords > 0 ? 'Captured COGS (AUD)' : fields[field]}</div><strong data-testid={`cogs-total-${field}`} style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18, color: 'var(--sv-text-strong)' }}>{field === 'cogs' ? cogsValue(data.summary) : display(field, data.summary[field])}</strong></div>)}
      </div>
      {(data.summary.missingCosts > 0 || data.summary.missingRevenue > 0) && <div role="note" style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 14 }}>{data.summary.missingCosts > 0 && <span>{data.summary.missingCosts.toLocaleString()} records have missing costs or incomplete fulfilment. Captured COGS excludes unavailable costs; full COGS and GP remain incomplete.</span>}{data.summary.missingRevenue > 0 && <span> {data.summary.missingRevenue.toLocaleString()} records have unavailable revenue.</span>}</div>}
      {tab === 'reconciliation' ? <div style={{ maxWidth: 900 }}><h2 style={{ fontSize: 17 }}>Movement-period reconciliation</h2><p style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>{data.reconciliation.scope}</p><dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(90px, 1fr)', gap: '12px 20px', fontSize: 13 }}>
        {Object.entries({ 'Recorded movement COGS (known amounts)': data.reconciliation.recordedMovementCogs, 'Selected report movement COGS': data.reconciliation.selectedMovementCogs, 'Eligible accounting COGS': data.reconciliation.accounting.totalCOGS, 'Corrections outside accounting movement types': data.reconciliation.otherMovementTypesCogs, 'Missing movement costs': data.reconciliation.missingMovementCosts, 'Historical movements excluded by accounting': data.reconciliation.accounting.excludedHistoricalMovementCount, 'Orphaned movements excluded by accounting': data.reconciliation.accounting.orphanedMovementCount, 'Non-stock movements excluded by accounting': data.reconciliation.accounting.excludedNonStockMovementCount, 'Accounting costs missing / unexplained zero': data.reconciliation.accounting.missingCostMovementCount + data.reconciliation.accounting.zeroCostMovementCount, 'Matched stock events outside selected sale period': data.reconciliation.outsideSalePeriodMovements, 'Movement / allocation rounding difference (AUD)': data.reconciliation.allocationRoundingDifference }).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd style={{ margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(value).toLocaleString('en-AU', { maximumFractionDigits: 6 })}</dd></React.Fragment>)}
      </dl><div role="status" style={{ marginTop: 16, color: data.reconciliation.accounting.blocked ? '#991b1b' : '#166534' }}>{data.reconciliation.accounting.blocked ? 'Accounting COGS contains missing or unexplained zero costs.' : 'Accounting cost checks passed for this period.'}</div></div> : data.rows.length === 0 ? <div style={{ padding: 30, color: 'var(--sv-text-dim)' }}>No records match this date basis and filters.</div> : <>
        <ReportScrollTable ariaLabel="Sales and COGS report, arrow-key scrolling" bodyClassName="cogs-traceability-table-scroll" tableWidth={tableWidth} renderColGroup={columnGroup} borderRadius={6} frozenColumnWidths={tab === 'detail' && columns[0] === 'orderRef' ? [widths[0], ...(columns[1] === 'sku' ? [widths[1]] : [])] : []} headerRows={<tr>{visibleColumns.map((field, index) => <th key={`${field}:${index}`} style={{ ...cell, height: 52, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0, textAlign: metrics.includes(field) ? 'right' : 'left' }}><button style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, fontSize: 'inherit', textTransform: 'inherit', fontWeight: 600, textAlign: 'inherit', cursor: 'pointer' }} onClick={() => { setSort(field); setDirection(sort === field && direction === 'desc' ? 'asc' : 'desc'); setPage(1); }}>{fields[field]}{sort === field && (direction === 'asc' ? <ArrowUp size={11} style={{ display: 'inline', marginLeft: 3 }} /> : <ArrowDown size={11} style={{ display: 'inline', marginLeft: 3 }} />)}</button></th>)}{tab === 'detail' && <th style={cell}> </th>}</tr>}>
          <tbody>{data.rows.map(row => <tr key={row.id}>{visibleColumns.map((field, index) => <td key={`${field}:${index}`} style={{ ...cell, textAlign: metrics.includes(field) ? 'right' : 'left', whiteSpace: metrics.includes(field) ? 'nowrap' : undefined, fontVariantNumeric: metrics.includes(field) ? 'tabular-nums' : undefined }}>{field === 'orderRef' && row.sourceHref ? <a href={row.sourceHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sv-action)' }}>{display(field, rowValue(row, field, index))}</a> : field === 'cogs' ? cogsValue(row) : display(field, rowValue(row, field, index))}</td>)}{tab === 'detail' && <td style={cell}><button title="Inspect transaction evidence" aria-label={`Inspect ${row.orderRef ?? row.id}`} style={iconButton} onClick={() => setSelected(row)}><Eye size={15} /></button></td>}</tr>)}</tbody>
        </ReportScrollTable>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '12px 0' }}><span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>{data.total.toLocaleString()} {tab === 'summary' ? 'groups' : 'records'}; page {page} of {Math.max(1, Math.ceil(data.total / 50))}</span><div style={{ display: 'flex', gap: 4 }}><button aria-label="Previous page" title="Previous page" style={iconButton} disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><button aria-label="Next page" title="Next page" style={iconButton} disabled={page * 50 >= data.total} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div></div>
      </>}
      <details style={{ marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--sv-etch)', fontSize: 12 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Data availability</summary><dl style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 1fr) minmax(0, 4fr)', gap: '8px 16px', marginTop: 12 }}>{Object.entries(data.availability).map(([field, description]) => <React.Fragment key={field}><dt>{field}</dt><dd style={{ margin: 0 }}>{description}</dd></React.Fragment>)}</dl></details>
    </>}
    {selected && <div role="dialog" aria-modal="true" aria-label="Transaction evidence" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.35)', display: 'flex', justifyContent: 'flex-end' }} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}><section style={{ background: 'var(--sv-bg-1)', width: 620, maxWidth: '100vw', height: '100%', overflowY: 'auto', padding: 20 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><h2 style={{ fontSize: 18 }}>Transaction evidence</h2><button title="Close evidence" aria-label="Close evidence" autoFocus style={iconButton} onClick={() => setSelected(null)}><X size={16} /></button></div>{selected.sourceHref && <a href={selected.sourceHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>Source document <ExternalLink size={14} /></a>}<dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '9px 16px', fontSize: 12 }}>{Object.entries(fields).map(([field, label]) => <React.Fragment key={field}><dt style={{ color: 'var(--sv-text-dim)' }}>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{display(field as Field, selected[field as Field])}</dd></React.Fragment>)}</dl><h3 style={{ fontSize: 15 }}>FIFO allocations</h3>{selectedAllocations.length ? selectedAllocations.map((allocation: Allocation) => <div key={allocation.id} style={{ padding: '10px 0', borderTop: '1px solid var(--sv-etch)', fontSize: 12 }}><strong>Layer {allocation.layerId} {allocation.poRef ?? ''}</strong><div>Movement {allocation.movementId}; {allocation.type}; quantity {allocation.qty}; unit cost AUD {allocation.unitCost.toFixed(6)}; allocated value AUD {allocation.value.toFixed(6)}</div><div>Layer date {allocation.receiptDate}; source {allocation.sourceType}; parent layer {allocation.parentLayerId ?? 'none'}</div></div>) : <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>No FIFO allocations recorded for these stock movements.</p>}</section></div>}
  </div>;
}