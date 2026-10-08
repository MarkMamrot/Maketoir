'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Eye, X } from 'lucide-react';
import type { loadPostingReconciliations } from '@/lib/ims/cogsTraceability/postings';
import { cogsChannelLabel } from '@/lib/xero/cogsPeriods';
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
const runWidths = [100, 130, 140, 155, 130, 155, 170, 310, 150, 180, 140];

export function CogsPostingLedger({
  range,
  revision,
  actions,
}: {
  range: SBDateRange;
  revision: number;
  actions?: { databaseId: string; isAdvisor: boolean; onChanged: () => void };
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const [selected, setSelected] = useState<Period | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (range.kind === 'range') { params.set('from', range.from); params.set('to', range.to); }
  else params.set('window', String(range.window));
  const query = params.toString();
  const pending = loading || loadedQuery !== query;
  const canPostPeriod = (period: Period) => period.draftCount === 0
    && period.uncertainCount === 0
    && !period.runs.some(run => run.status === 'failed' && run.target === period.calculation.totalCOGS)
    && (period.postedCount === 0 || period.liveVerificationComplete)
    && (period.liveVariance ?? period.variance) !== 0;

  const retryRun = async (runId: number) => {
    if (!actions || !confirm(`Retry failed COGS run ${runId}?`)) return;
    setActionBusy(`retry:${runId}`);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/xero/cogs/runs/${runId}/retry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: actions.databaseId }),
      });
      const body = await response.json();
      if (body.outcome === 'changed') {
        setActionMessage({ ok: false, text: 'COGS changed since this failure. Review the period and post the current difference instead of replaying the old journal.' });
      } else if (!response.ok && response.status !== 202) {
        throw new Error(body.error || body.reason || 'COGS retry failed.');
      } else {
        setActionMessage({ ok: body.outcome === 'posted', text: body.outcome === 'posted' ? 'COGS journal posted successfully.' : 'Xero did not confirm the retry. Verify the outcome before taking another action.' });
        actions.onChanged();
      }
    } catch (retryError) {
      setActionMessage({ ok: false, text: retryError instanceof Error ? retryError.message : 'COGS retry failed.' });
    } finally { setActionBusy(''); }
  };

  const postDifference = async (period: Period) => {
    if (!actions) return;
    let overrideReason: string | undefined;
    if (period.calculation.blocked) {
      if (actions.isAdvisor) { setActionMessage({ ok: false, text: 'An administrator must resolve or override the valuation checks.' }); return; }
      const reason = prompt('This period has missing or unexplained zero costs. Enter the reason for posting the known amount, or Cancel to fix costs first.');
      if (!reason?.trim()) return;
      overrideReason = reason.trim();
    } else if (!confirm(`Post the current COGS difference for ${periodLabel(period.from, period.toExclusive)}?`)) return;
    setActionBusy(`post:${period.from}:${period.toExclusive}`);
    setActionMessage(null);
    try {
      const response = await fetch('/api/xero/cogs/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: actions.databaseId, frequency: period.runs[0]?.frequency,
          startDate: period.from, endDateExclusive: period.toExclusive, overrideReason }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(body.error || body.reason || 'COGS posting failed.');
      if (body.outcome === 'already_claimed' && body.status !== 'success') {
        throw new Error(`An existing COGS run is ${body.status}. Open its run history before taking another action.`);
      }
      setActionMessage({ ok: body.outcome === 'posted' || body.outcome === 'current', text: body.outcome === 'posted'
        ? `${body.runKind === 'adjustment' ? 'COGS adjustment' : 'COGS journal'} posted successfully.`
        : body.outcome === 'current' ? 'This period is already current.' : 'Xero did not confirm the result. Verify it before retrying.' });
      actions.onChanged();
    } catch (postError) {
      setActionMessage({ ok: false, text: postError instanceof Error ? postError.message : 'COGS posting failed.' });
    } finally { setActionBusy(''); }
  };

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
    {actionMessage && <div role="status" style={{ padding: '9px 12px', margin: '8px 0 12px', border: `1px solid ${actionMessage.ok ? '#86efac' : '#fecaca'}`, background: actionMessage.ok ? '#f0fdf4' : '#fef2f2', color: actionMessage.ok ? '#166534' : '#991b1b', fontSize: 12 }}>{actionMessage.text}</div>}
    {error ? <div role="alert" style={{ padding: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca' }}>{error}</div>
      : pending ? <div role="status" style={{ padding: '24px 0', fontSize: 13, color: 'var(--sv-text-dim)' }}>Loading posting history...</div>
        : data && <>
          <p style={{ fontSize: 12, color: 'var(--sv-text-dim)', margin: '8px 0' }}>{data.scope}</p>
          <p role="note" style={{ fontSize: 12, color: 'var(--sv-text-dim)', margin: '8px 0 16px' }}>{data.statusEvidence}</p>
          {data.rows.length === 0 ? <div role="status" data-testid="cogs-postings-empty" style={{ padding: '24px 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>{data.tableAvailable ? 'No recorded COGS journal runs overlap this date range.' : 'COGS posting history has not been configured.'}</div> : <>
            <ReportScrollTable ariaLabel="COGS posting periods, arrow-key scrolling" bodyClassName="cogs-posting-periods-scroll" tableWidth={periodWidths.reduce((sum, width) => sum + width, 0)} renderColGroup={() => <colgroup>{periodWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>} borderRadius={6} frozenColumnWidths={[periodWidths[0]]} headerRows={<tr>{['Accounting period', 'Current eligible COGS', 'Recorded posted', 'Recorded drafts', 'Difference', 'Reconciliation', ''].map((label, index) => <th key={index} style={{ ...header, textAlign: index > 0 && index < 5 ? 'right' : 'left' }}>{label}</th>)}</tr>}>
              <tbody>{data.rows.map((period, index) => <tr key={`${period.from}:${period.toExclusive}`} style={{ background: index % 2 ? 'var(--sv-bg-1)' : 'var(--sv-bg-0)' }}>
                <td style={cell}>{periodLabel(period.from, period.toExclusive)}</td>
                <td style={numberCell}>{money(period.calculation.totalCOGS)}{period.calculation.blocked && <div style={{ fontSize: 11, color: '#991b1b' }}>Incomplete costs</div>}</td>
                <td style={numberCell}>{money(period.livePostedTotal ?? period.postedTotal)}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.liveVerificationComplete ? 'Verified with Xero now' : 'Recorded; live check unavailable'}</div></td>
                <td style={numberCell}>{money(period.draftTotal)}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.draftCount} journals</div></td>
                <td style={numberCell}>{money(period.liveVariance ?? period.variance)}</td>
                <td style={cell}>{period.state}{period.failedCount > 0 && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{period.failedCount} failed attempts in history</div>}{actions && canPostPeriod(period) && <button disabled={Boolean(actionBusy)} onClick={() => void postDifference(period)} style={{ marginTop: 7, border: '1px solid var(--sv-action)', borderRadius: 6, background: 'var(--sv-action)', color: '#fff', padding: '5px 8px', fontSize: 11, cursor: actionBusy ? 'not-allowed' : 'pointer' }}>{actionBusy === `post:${period.from}:${period.toExclusive}` ? 'Posting...' : period.calculation.blocked ? 'Post with override' : period.postedCount > 0 ? 'Post adjustment' : 'Post COGS'}</button>}</td>
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
            <ReportScrollTable ariaLabel="COGS journal runs, arrow-key scrolling" bodyClassName="cogs-posting-runs-scroll" tableWidth={runWidths.reduce((sum, width) => sum + width, 0)} renderColGroup={() => <colgroup>{runWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>} borderRadius={6} frozenColumnWidths={[runWidths[0]]} headerRows={<tr>{['Run', 'Journal date', 'Kind / schedule', 'Run delta (AUD)', 'Run status', 'Recorded Xero state', 'Target at run (AUD)', 'Journal line-item snapshot', 'Cost checks at run', 'Run created', 'Xero journal'].map((label, index) => <th key={index} style={header}>{label}</th>)}</tr>}>
              <tbody>{selected.runs.map((run, index) => <tr key={run.id} style={{ background: index % 2 ? 'var(--sv-bg-1)' : 'var(--sv-bg-0)' }}>
                <td style={cell}>{run.id}</td><td style={cell}>{run.journalDate}</td><td style={cell}>{run.kind}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{run.frequency}</div></td><td style={numberCell}>{money(run.amount)}</td><td style={cell}>{run.status}{run.errorDetail && <div style={{ marginTop: 4, fontSize: 11, color: '#991b1b' }}>{run.errorDetail}</div>}{run.overrideReason && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--sv-text-dim)' }}>Override: {run.overrideReason}</div>}{actions && run.status === 'failed' && !run.xeroId && run.target === selected.calculation.totalCOGS && <button disabled={Boolean(actionBusy)} onClick={() => void retryRun(run.id)} style={{ marginTop: 7, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '5px 8px', fontSize: 11, cursor: actionBusy ? 'not-allowed' : 'pointer' }}>{actionBusy === `retry:${run.id}` ? 'Retrying...' : 'Retry failed posting'}</button>}</td><td style={cell}>{run.liveVerification === 'verified' ? run.liveXeroStatus ?? 'Status absent' : run.xeroStatus ?? 'Not recorded'}<div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{run.liveVerification === 'verified' ? 'Verified with Xero now' : run.liveVerification === 'unavailable' ? `Live check unavailable; recorded ${run.xeroStatus ?? 'unknown'}` : `Recorded ${run.updatedAt}`}</div></td><td style={numberCell}>{money(run.target)}</td><td style={cell}>{run.buckets?.length ? run.buckets.map(bucket => <div key={`${bucket.locationId}:${bucket.channel}`}>{bucket.locationName} - {cogsChannelLabel(bucket.channel)}: {money(bucket.amount)}</div>) : <span style={{ color: 'var(--sv-text-dim)' }}>Not captured for this legacy run</span>}</td><td style={cell}>{run.missingCosts} missing<br />{run.zeroCosts} unexplained zero</td><td style={cell}>{run.recordedAt}</td><td style={cell}>{run.href ? <a href={run.href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--sv-action)' }}>View journal <ExternalLink size={13} /></a> : 'No journal ID'}</td>
              </tr>)}</tbody>
            </ReportScrollTable>
            <h4 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--sv-text-strong)' }}>Current movement evidence</h4>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(70px, 1fr)', gap: '8px 16px', fontSize: 12, maxWidth: 700 }}>
              {Object.entries({ 'Eligible movements': selected.calculation.includedMovementCount, 'Missing cost': selected.calculation.missingCostMovementCount, 'Unexplained zero cost': selected.calculation.zeroCostMovementCount, 'Approved zero cost': selected.calculation.intentionalZeroCostMovementCount, 'Historical movements excluded': selected.calculation.excludedHistoricalMovementCount, 'Orphaned movements excluded': selected.calculation.orphanedMovementCount, 'Non-stock movements excluded': selected.calculation.excludedNonStockMovementCount }).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd style={{ margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</dd></React.Fragment>)}
            </dl>
            <h4 style={{ fontSize: 13, margin: '20px 0 8px', color: 'var(--sv-text-strong)' }}>Current eligible COGS by location / accounting channel</h4>
            <p style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Recalculated from current movement evidence, not an as-posted journal allocation.</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(100px, 1fr)', gap: '8px 16px', maxWidth: 700, fontSize: 12 }}>
              {selected.calculation.breakdown.map(bucket => <React.Fragment key={`${bucket.locationId}:${bucket.channel}`}><dt>{bucket.locationName} / {bucket.channel} ({bucket.movementCount.toLocaleString()} movements)</dt><dd style={{ margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(bucket.totalCOGS)}</dd></React.Fragment>)}
            </dl>
          </section>}
        </>}
  </section>;
}