'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Eye, X } from 'lucide-react';
import type { loadPostingReconciliations } from '@/lib/ims/cogsTraceability/postings';
import { ReportScrollTable } from './ReportScrollTable';
import type { SBDateRange } from './reportFilterHelpers';

type Ledger = Awaited<ReturnType<typeof loadPostingReconciliations>>;
type Period = Ledger['rows'][number];
const money = (value: number) => value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const periodLabel = (from: string, toExclusive: string) => `${from} to ${new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)}`;
const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13, verticalAlign: 'middle', overflowWrap: 'anywhere', color: 'var(--sv-text-main)' };
const numberCell: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const button: React.CSSProperties = { border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', width: 34, height: 34, padding: 0, display: 'inline-grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 };
const header: React.CSSProperties = { ...cell, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0, textAlign: 'left', height: 52 };
const periodWidths = [240, 160, 165, 145, 150, 260, 54];
const runWidths = [100, 130, 140, 155, 130, 155, 170, 150, 180, 140];

export function CogsPostingLedger({ range, revision }: { range: SBDateRange; revision: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const [selected, setSelected] = useState<Period | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (range.kind === 'range') { params.set('from', range.from); params.set('to', range.to); }
  else params.set('window', String(range.window));
  const query = params.toString();
  const pending = loading || loadedQuery !== query;

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setSelected(null);
    fetch(`/api/ims/reports/cogs-traceability/postings?${query}`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || 'Posting history could not be loaded.'); return body as Ledger; })
      .then(body => { if (!abort.signal.aborted) { setData(body); setLoadedQuery(query); } })
      .catch(loadError => { if (!abort.signal.aborted) setError(loadError instanceof Error ? loadError.message : 'Posting history could not be loaded.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [query, revision]);

  return <section aria-label="Xero COGS posting ledger" style={{ minWidth: 0, width: '100%' }}>
    <h2 style={{ fontSize: 17, margin: '8px 0', color: 'var(--sv-text-strong)' }}>COGS journals and period reconciliations</h2>
    {error ? <div role="alert" style={{ padding: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca' }}>{error}</div>
      : pending ? <div role="status" style={{ padding: '24px 0', fontSize: 13, color: 'var(--sv-text-dim)' }}>Loading posting history...</div>
        : data && <>
          <p style={{ fontSize: 12, color: 'var(--sv-text-dim)', margin: '8px 0' }}>{data.scope}</p>
          <p role="note" style={{ fontSize: 12, color: 'var(--sv-text-dim)', margin: '8px 0 16px' }}>{data.statusEvidence}</p>
          {data.rows.length === 0 ? <div role="status" data-testid="cogs-postings-empty" style={{ padding: '24px 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>{data.tableAvailable ? 'No recorded COGS journal runs overlap this date range.' : 'COGS posting history has not been configured.'}</div> : <>
            <ReportScrollTable ariaLabel="COGS posting periods, arrow-key scrolling" bodyClassName="cogs-posting-periods-scroll" tableWidth={periodWidths.reduce((sum, width) => sum + width, 0)} renderColGroup={() => <colgroup>{periodWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>} borderRadius={6} frozenColumnWidths={[periodWidths[0]]} headerRows={<tr>{['Accounting period', 'Current eligible COGS', 'Recorded posted', 'Recorded drafts', 'Difference', 'Reconciliation', ''].map((label, index) => <th key={index} style={{ ...header, textAlign: index > 0 && index < 5 ? 'right' : 'left' }}>{label}</th>)}</tr>}>
              <tbody>{data.rows.map(period => <tr key={`${period.from}:${period.toExclusive}`}>
                <td style={cell}>{periodLabel(period.from, period.toExclusive)}</td>
                <td style={numberCell}>{money(period.calculation.totalCOGS)}{period.calculation.blocked && <div style={{ fontSize: 11, color: '#991b1b' }}>Incomplete costs</div>}</td>
                <td style={numberCell}>{money(period.postedTotal)}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.postedCount} journals</div></td>
                <td style={numberCell}>{money(period.draftTotal)}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.draftCount} journals</div></td>
                <td style={numberCell}>{money(period.variance)}</td>
                <td style={cell}>{period.state}{period.failedCount > 0 && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.failedCount} failed attempts in history</div>}</td>
                <td style={cell}><button style={button} title="Inspect journals and reconciliation" aria-label={`Inspect accounting period ${period.from}`} aria-pressed={selected?.from === period.from && selected?.toExclusive === period.toExclusive} onClick={() => setSelected(period)}><Eye size={15} /></button></td>
              </tr>)}</tbody>
            </ReportScrollTable>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 0', fontSize: 12, color: 'var(--sv-text-dim)' }}>
              <span>{data.total.toLocaleString()} accounting periods; page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
              <div style={{ display: 'flex', gap: 4 }}><button style={button} aria-label="Previous posting page" title="Previous posting page" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><button style={button} aria-label="Next posting page" title="Next posting page" disabled={page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div>
            </div>
          </>}
          {selected && <section aria-label="Accounting period evidence" style={{ borderTop: '1px solid var(--sv-etch)', padding: '16px 0', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><h3 style={{ margin: 0, fontSize: 15, color: 'var(--sv-text-strong)' }}>{periodLabel(selected.from, selected.toExclusive)}</h3><button style={button} title="Close period evidence" aria-label="Close period evidence" onClick={() => setSelected(null)}><X size={15} /></button></div>
            <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Difference = current eligible COGS minus recorded posted journals, including signed original and adjustment amounts. This is not an instruction to post an adjustment.</p>
            <ReportScrollTable ariaLabel="COGS journal runs, arrow-key scrolling" bodyClassName="cogs-posting-runs-scroll" tableWidth={runWidths.reduce((sum, width) => sum + width, 0)} renderColGroup={() => <colgroup>{runWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>} borderRadius={6} frozenColumnWidths={[runWidths[0]]} headerRows={<tr>{['Run', 'Journal date', 'Kind / schedule', 'Run delta (AUD)', 'Run status', 'Recorded Xero state', 'Target at run (AUD)', 'Cost checks at run', 'Run created', 'Xero journal'].map((label, index) => <th key={index} style={header}>{label}</th>)}</tr>}>
              <tbody>{selected.runs.map(run => <tr key={run.id}>
                <td style={cell}>{run.id}</td><td style={cell}>{run.journalDate}</td><td style={cell}>{run.kind}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{run.frequency}</div></td><td style={numberCell}>{money(run.amount)}</td><td style={cell}>{run.status}</td><td style={cell}>{run.xeroStatus ?? 'Not recorded'}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Record updated {run.updatedAt}</div></td><td style={numberCell}>{money(run.target)}</td><td style={cell}>{run.missingCosts} missing<br />{run.zeroCosts} unexplained zero</td><td style={cell}>{run.recordedAt}</td><td style={cell}>{run.href ? <a href={run.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--sv-action)' }}>View journal <ExternalLink size={13} /></a> : 'No journal ID'}</td>
              </tr>)}</tbody>
            </ReportScrollTable>
            <h4 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--sv-text-strong)' }}>Current movement evidence</h4>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(70px, 1fr)', gap: '8px 16px', fontSize: 12, maxWidth: 700 }}>
              {Object.entries({ 'Eligible movements': selected.calculation.includedMovementCount, 'Missing cost': selected.calculation.missingCostMovementCount, 'Unexplained zero cost': selected.calculation.zeroCostMovementCount, 'Approved zero cost': selected.calculation.intentionalZeroCostMovementCount, 'Historical movements excluded': selected.calculation.excludedHistoricalMovementCount, 'Orphaned movements excluded': selected.calculation.orphanedMovementCount, 'Non-stock movements excluded': selected.calculation.excludedNonStockMovementCount }).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd style={{ margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</dd></React.Fragment>)}
            </dl>
            <h4 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--sv-text-strong)' }}>Current eligible COGS by location / accounting channel</h4>
            <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Recalculated from current movement evidence, not an as-posted journal allocation.</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(100px, 1fr)', gap: '8px 16px', maxWidth: 700, fontSize: 12 }}>
              {selected.calculation.breakdown.map(bucket => <React.Fragment key={`${bucket.locationId}:${bucket.channel}`}><dt>Location {bucket.locationId || 'not recorded'} / {bucket.channel} ({bucket.movementCount.toLocaleString()} movements)</dt><dd style={{ margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(bucket.totalCOGS)}</dd></React.Fragment>)}
            </dl>
          </section>}
        </>}
  </section>;
}