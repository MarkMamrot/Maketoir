'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, Funnel, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { PresentedAuditFinding } from '@/lib/ims/bookkeeperAudit/domain';
import { ReportScrollTable } from './ReportScrollTable';
import { SBDatePicker, type SBDateRange } from './reportFilterHelpers';

type AuditStatus = 'open' | 'accepted';
type AuditResponse = {
  success: boolean;
  error?: string;
  asOfDate: string;
  checkedAt: string;
  coverage: { operational: string; cogs: string; xero: string; monthEndInventory: string };
  summary: { open: number; accepted: number; critical: number; error: number; warning: number };
  items: PresentedAuditFinding[];
};

const cell: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--sv-etch)', verticalAlign: 'top' };
const heading: React.CSSProperties = { ...cell, background: 'var(--sv-bg-2)', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' };
const money = (value: number | null) => value == null ? '-' : value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const shortDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-AU');
const ALL_DATES: SBDateRange = { kind: 'range', from: '1900-01-01', to: '9999-12-31', label: 'All dates' };

function sourceTypeLabel(value: string) {
  return value.split('_').map(word => word ? `${word[0].toUpperCase()}${word.slice(1)}` : '').join(' ');
}

function dateRangeBounds(range: SBDateRange) {
  if (range.kind === 'range') return { from: range.from, to: range.to };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - range.window + 1);
  return { from: from.toLocaleDateString('sv-SE'), to: to.toLocaleDateString('sv-SE') };
}

function severityTone(severity: PresentedAuditFinding['severity']) {
  if (severity === 'critical') return '#991b1b';
  if (severity === 'error') return '#c2410c';
  return '#a16207';
}

export function BookkeeperAuditView({ onBack, canReview }: { onBack: () => void; canReview: boolean }) {
  const [status, setStatus] = useState<AuditStatus>('open');
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceType, setSourceType] = useState('all');
  const [severity, setSeverity] = useState<'all' | PresentedAuditFinding['severity']>('all');
  const [dateRange, setDateRange] = useState<SBDateRange>(ALL_DATES);
  const [minimumValue, setMinimumValue] = useState('');
  const [maximumValue, setMaximumValue] = useState('');
  const filtersRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/reports/bookkeeper-audit?status=${status}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Failed to load Bookkeeper Audit.');
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Bookkeeper Audit.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const closeFilters = (event: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('mousedown', closeFilters);
    return () => document.removeEventListener('mousedown', closeFilters);
  }, []);

  const review = async (finding: PresentedAuditFinding, action: 'accept' | 'undo') => {
    const reason = action === 'accept'
      ? window.prompt('Why is this exception acceptable? This will be kept in the audit history.', '')?.trim()
      : '';
    if (action === 'accept' && !reason) return;
    setSavingKey(finding.key);
    setError('');
    try {
      const response = await fetch('/api/ims/reports/bookkeeper-audit/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, findingKey: finding.key, fingerprint: finding.fingerprint, reason }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'The audit review could not be saved.');
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The audit review could not be saved.');
    } finally {
      setSavingKey('');
    }
  };

  const columns = () => <colgroup><col style={{ width: 105 }} /><col style={{ width: 100 }} /><col style={{ width: 175 }} /><col style={{ width: 330 }} /><col style={{ width: 155 }} /><col style={{ width: 130 }} /><col style={{ width: 170 }} /></colgroup>;
  const checksIncomplete = data && (data.coverage.cogs !== 'checked' || data.coverage.xero !== 'checked' || data.coverage.monthEndInventory !== 'checked');
  const sourceTypes = [...new Set((data?.items ?? []).map(item => item.sourceType))].sort((left, right) => sourceTypeLabel(left).localeCompare(sourceTypeLabel(right)));
  const dateBounds = dateRangeBounds(dateRange);
  const minimumValueNumber = minimumValue === '' ? null : Number(minimumValue);
  const maximumValueNumber = maximumValue === '' ? null : Number(maximumValue);
  const filteredItems = (data?.items ?? []).filter(finding => {
    const findingDate = finding.occurredAt.slice(0, 10);
    const value = finding.valueAtRisk;
    return (sourceType === 'all' || finding.sourceType === sourceType)
      && (severity === 'all' || finding.severity === severity)
      && findingDate >= dateBounds.from && findingDate <= dateBounds.to
      && (minimumValueNumber == null || (value != null && value >= minimumValueNumber))
      && (maximumValueNumber == null || (value != null && value <= maximumValueNumber));
  });
  const activeFilterCount = Number(sourceType !== 'all') + Number(severity !== 'all') + Number(dateRange.label !== ALL_DATES.label)
    + Number(minimumValue !== '') + Number(maximumValue !== '');
  const clearFilters = () => {
    setSourceType('all');
    setSeverity('all');
    setDateRange(ALL_DATES);
    setMinimumValue('');
    setMaximumValue('');
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <button onClick={onBack} title="Back to reports" style={{ border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', padding: '7px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 12 }}><ArrowLeft size={15} /> Reports</button>
          <h1 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 22 }}>Bookkeeper Audit</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>Periodic accounting, stock, and document exceptions requiring review.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} title="Refresh audit" style={{ border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', width: 36, height: 36, borderRadius: 6, display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer' }}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ border: '1px solid var(--sv-etch)', borderTop: '3px solid #c2410c', borderRadius: 8, padding: 14, background: 'var(--sv-bg-1)' }}><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Action required</div><div style={{ fontSize: 24, fontWeight: 750, marginTop: 7 }}>{data?.summary.open ?? 0}</div></div>
        <div style={{ border: '1px solid var(--sv-etch)', borderTop: '3px solid #a16207', borderRadius: 8, padding: 14, background: 'var(--sv-bg-1)' }}><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Errors / warnings</div><div style={{ fontSize: 24, fontWeight: 750, marginTop: 7 }}>{(data?.summary.error ?? 0) + (data?.summary.warning ?? 0)}</div></div>
        <div style={{ border: '1px solid var(--sv-etch)', borderTop: '3px solid #15803d', borderRadius: 8, padding: 14, background: 'var(--sv-bg-1)' }}><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Accepted exceptions</div><div style={{ fontSize: 24, fontWeight: 750, marginTop: 7 }}>{data?.summary.accepted ?? 0}</div></div>
        <div style={{ border: '1px solid var(--sv-etch)', borderTop: `3px solid ${checksIncomplete ? '#a16207' : '#15803d'}`, borderRadius: 8, padding: 14, background: 'var(--sv-bg-1)' }}><div style={{ color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>Coverage</div><div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, marginTop: 10 }}>{checksIncomplete ? <><ShieldAlert size={17} color="#a16207" /> Checks incomplete</> : <><CheckCircle2 size={17} color="#15803d" /> All checked</>}</div></div>
      </div>

      {checksIncomplete && <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, padding: '10px 12px', border: '1px solid #fde68a', background: '#fffbeb', color: '#854d0e', borderRadius: 6, fontSize: 13 }}><AlertCircle size={16} /> {data?.coverage.cogs !== 'checked' ? 'COGS checks could not be completed. ' : ''}{data?.coverage.xero !== 'checked' ? 'Xero reconciliation could not be completed. ' : ''}{data?.coverage.monthEndInventory !== 'checked' ? 'Prior month-end inventory comparison is not included yet.' : ''}</div>}
      {error && <div role="alert" style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 6 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div role="tablist" aria-label="Audit status" style={{ display: 'flex', gap: 4 }}>
          {(['open', 'accepted'] as const).map(option => <button key={option} role="tab" aria-selected={status === option} onClick={() => setStatus(option)} style={{ border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', background: status === option ? 'var(--sv-text-strong)' : 'var(--sv-bg-1)', color: status === option ? 'var(--sv-bg-1)' : 'var(--sv-text)', fontWeight: 700, textTransform: 'capitalize' }}>{option}</button>)}
        </div>
        <div ref={filtersRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeFilterCount > 0 && <span style={{ color: 'var(--sv-text-dim)', fontSize: 12 }}>Showing {filteredItems.length} of {data?.items.length ?? 0}</span>}
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)} style={{ height: 34, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${filtersOpen || activeFilterCount > 0 ? 'var(--sv-action)' : 'var(--sv-etch)'}`, borderRadius: 7, padding: '0 10px', background: filtersOpen || activeFilterCount > 0 ? 'color-mix(in srgb, var(--sv-action) 10%, var(--sv-bg-1))' : 'var(--sv-bg-1)', color: filtersOpen || activeFilterCount > 0 ? 'var(--sv-action)' : 'var(--sv-text)', cursor: 'pointer', fontWeight: 700 }}><Funnel size={14} /> Filters{activeFilterCount > 0 && <span style={{ minWidth: 18, height: 18, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--sv-action)', color: '#fff', fontSize: 10 }}>{activeFilterCount}</span>}<ChevronDown size={13} /></button>
          {filtersOpen && <div role="dialog" aria-label="Filter audit findings" style={{ position: 'absolute', zIndex: 600, top: 'calc(100% + 6px)', right: 0, width: 330, maxWidth: 'calc(100vw - 24px)', border: '1px solid var(--sv-etch)', borderRadius: 8, background: 'var(--sv-bg-1)', boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}><strong style={{ fontSize: 14 }}>Filter findings</strong><button type="button" title="Close filters" onClick={() => setFiltersOpen(false)} style={{ width: 28, height: 28, border: 0, background: 'transparent', color: 'var(--sv-text-dim)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={15} /></button></div>
            <label style={{ display: 'block', marginBottom: 10 }}><span style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Source type</span><select value={sourceType} onChange={event => setSourceType(event.target.value)} style={{ width: '100%', height: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 8px' }}><option value="all">All source types</option>{sourceTypes.map(option => <option key={option} value={option}>{sourceTypeLabel(option)}</option>)}</select></label>
            <label style={{ display: 'block', marginBottom: 10 }}><span style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Severity</span><select value={severity} onChange={event => setSeverity(event.target.value as typeof severity)} style={{ width: '100%', height: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 8px' }}><option value="all">All severities</option><option value="critical">Critical</option><option value="error">Error</option><option value="warning">Warning</option></select></label>
            <div style={{ marginBottom: 10 }}><span style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Finding date</span><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SBDatePicker value={dateRange} onChange={setDateRange} />{dateRange.label !== ALL_DATES.label && <button type="button" onClick={() => setDateRange(ALL_DATES)} style={{ border: 0, background: 'transparent', color: 'var(--sv-action)', cursor: 'pointer', fontSize: 12 }}>All dates</button>}</div></div>
            <div style={{ marginBottom: 12 }}><span style={{ display: 'block', color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Value at risk (AUD)</span><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><input type="number" min="0" step="0.01" value={minimumValue} onChange={event => setMinimumValue(event.target.value)} placeholder="Minimum" aria-label="Minimum value at risk" style={{ minWidth: 0, height: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 8px' }} /><input type="number" min="0" step="0.01" value={maximumValue} onChange={event => setMaximumValue(event.target.value)} placeholder="Maximum" aria-label="Maximum value at risk" style={{ minWidth: 0, height: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text)', padding: '0 8px' }} /></div></div>
            <button type="button" onClick={clearFilters} disabled={activeFilterCount === 0} style={{ width: '100%', height: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text)', cursor: activeFilterCount === 0 ? 'default' : 'pointer', opacity: activeFilterCount === 0 ? .5 : 1 }}>Clear filters</button>
          </div>}
        </div>
      </div>

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading audit findings...</div> : !data?.items.length ? <div style={{ padding: 30, textAlign: 'center', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>{status === 'open' ? 'No operational findings require attention.' : 'No accepted exceptions.'}</div> : filteredItems.length === 0 ? <div style={{ padding: 30, textAlign: 'center', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>No findings match the selected filters.</div> : (
        <ReportScrollTable ariaLabel="Bookkeeper audit findings" bodyClassName="bookkeeper-audit-report-scroll" tableWidth={1165} renderColGroup={columns} frozenColumnWidths={[105, 100]} headerRows={<tr><th style={heading}>Date</th><th style={heading}>Severity</th><th style={heading}>Source</th><th style={heading}>Finding</th><th style={heading}>Due / expected</th><th style={{ ...heading, textAlign: 'right' }}>Value at risk</th><th style={heading}>Action</th></tr>}>
          <tbody>{filteredItems.map(finding => <tr key={`${finding.key}:${finding.fingerprint}`}>
            <td style={cell}>{shortDate(finding.occurredAt)}</td>
            <td style={cell}><span style={{ color: severityTone(finding.severity), fontWeight: 800, textTransform: 'capitalize' }}>{finding.severity}</span></td>
            <td style={cell}>{finding.sourceHref ? <a href={finding.sourceHref} target="_blank" rel="noopener noreferrer" title={finding.sourceHref.startsWith('http') ? 'Open source in Xero in a new tab' : 'Open source document in a new tab'} style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>{finding.sourceReference} <ExternalLink size={13} /></a> : <div style={{ fontWeight: 700 }}>{finding.sourceReference}</div>}{finding.sourceContext && <div style={{ color: 'var(--sv-text-main)', fontSize: 12, marginTop: 3 }}>{finding.sourceContext}</div>}<div style={{ color: 'var(--sv-text-dim)', fontSize: 11, marginTop: 3 }}>{finding.sourceType.replaceAll('_', ' ')}</div></td>
            <td style={cell}><div style={{ fontWeight: 700 }}>{finding.title}</div><div style={{ color: 'var(--sv-text-dim)', fontSize: 12, marginTop: 4 }}>{finding.summary}</div><div style={{ fontSize: 12, marginTop: 6 }}>{finding.recommendedAction}</div>{finding.detail && <details style={{ marginTop: 8, borderTop: '1px solid var(--sv-etch)', paddingTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--sv-action)', fontSize: 12, fontWeight: 700 }}>Why these states are incompatible</summary><div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', marginTop: 7, fontSize: 12 }}><strong>Solvantis</strong><span>{finding.detail.localState.replaceAll('_', ' ')}</span><strong>Xero</strong><span>{finding.detail.xeroState.replaceAll('_', ' ')}</span></div><div style={{ color: 'var(--sv-text-dim)', fontSize: 12, marginTop: 6 }}>{finding.detail.explanation}</div></details>}{finding.review && <div style={{ color: '#166534', fontSize: 11, marginTop: 6 }}>Accepted by {finding.review.actorName || 'staff'}: {finding.review.reason}</div>}</td>
            <td style={cell}>{finding.dueDate ? <><div>{shortDate(finding.dueDate.date)}</div>{finding.dueDate.source === 'assumed' && <div style={{ color: '#a16207', fontSize: 11, marginTop: 3 }}>Assumed: {finding.dueDate.assumedDays} days after document date</div>}</> : '-'}</td>
            <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(finding.valueAtRisk)}</td>
            <td style={cell}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>{finding.xeroHref && <a href={finding.xeroHref} target="_blank" rel="noopener noreferrer" title="Open the document in Xero" style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>View in Xero <ExternalLink size={13} /></a>}{finding.xeroHistoryHref && <a href={finding.xeroHistoryHref} target="_blank" rel="noopener noreferrer" title="Open Xero Sync History in a new tab" style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>Xero Sync History <ExternalLink size={13} /></a>}{canReview && <button disabled={savingKey === finding.key} onClick={() => void review(finding, finding.reviewStatus === 'accepted' ? 'undo' : 'accept')} style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, padding: '4px 7px', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', cursor: 'pointer' }}>{finding.reviewStatus === 'accepted' ? 'Undo' : 'Accept exception'}</button>}</div></td>
          </tr>)}</tbody>
        </ReportScrollTable>
      )}
    </div>
  );
}