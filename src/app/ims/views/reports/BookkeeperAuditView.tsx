'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import type { PresentedAuditFinding } from '@/lib/ims/bookkeeperAudit/domain';
import { ReportScrollTable } from './ReportScrollTable';

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

      <div role="tablist" aria-label="Audit status" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['open', 'accepted'] as const).map(option => <button key={option} role="tab" aria-selected={status === option} onClick={() => setStatus(option)} style={{ border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', background: status === option ? 'var(--sv-text-strong)' : 'var(--sv-bg-1)', color: status === option ? 'var(--sv-bg-1)' : 'var(--sv-text)', fontWeight: 700, textTransform: 'capitalize' }}>{option}</button>)}
      </div>

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading audit findings...</div> : !data?.items.length ? <div style={{ padding: 30, textAlign: 'center', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-dim)' }}>{status === 'open' ? 'No operational findings require attention.' : 'No accepted exceptions.'}</div> : (
        <ReportScrollTable ariaLabel="Bookkeeper audit findings" bodyClassName="bookkeeper-audit-report-scroll" tableWidth={1165} renderColGroup={columns} frozenColumnWidths={[105, 100]} headerRows={<tr><th style={heading}>Date</th><th style={heading}>Severity</th><th style={heading}>Source</th><th style={heading}>Finding</th><th style={heading}>Due / expected</th><th style={{ ...heading, textAlign: 'right' }}>Value at risk</th><th style={heading}>Action</th></tr>}>
          <tbody>{data.items.map(finding => <tr key={`${finding.key}:${finding.fingerprint}`}>
            <td style={cell}>{shortDate(finding.occurredAt)}</td>
            <td style={cell}><span style={{ color: severityTone(finding.severity), fontWeight: 800, textTransform: 'capitalize' }}>{finding.severity}</span></td>
            <td style={cell}>{finding.sourceHref ? <a href={finding.sourceHref} title="Open source document" style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>{finding.sourceReference} <ExternalLink size={13} /></a> : <div style={{ fontWeight: 700 }}>{finding.sourceReference}</div>}<div style={{ color: 'var(--sv-text-dim)', fontSize: 11, marginTop: 3 }}>{finding.sourceType.replaceAll('_', ' ')}</div></td>
            <td style={cell}><div style={{ fontWeight: 700 }}>{finding.title}</div><div style={{ color: 'var(--sv-text-dim)', fontSize: 12, marginTop: 4 }}>{finding.summary}</div><div style={{ fontSize: 12, marginTop: 6 }}>{finding.recommendedAction}</div>{finding.review && <div style={{ color: '#166534', fontSize: 11, marginTop: 6 }}>Accepted by {finding.review.actorName || 'staff'}: {finding.review.reason}</div>}</td>
            <td style={cell}>{finding.dueDate ? <><div>{shortDate(finding.dueDate.date)}</div>{finding.dueDate.source === 'assumed' && <div style={{ color: '#a16207', fontSize: 11, marginTop: 3 }}>Assumed: {finding.dueDate.assumedDays} days after document date</div>}</> : '-'}</td>
            <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(finding.valueAtRisk)}</td>
            <td style={cell}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>{finding.xeroHistoryHref && <a href={finding.xeroHistoryHref} title="Open Xero Sync History" style={{ color: 'var(--sv-action)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>Xero Sync History <ExternalLink size={13} /></a>}{canReview && <button disabled={savingKey === finding.key} onClick={() => void review(finding, finding.reviewStatus === 'accepted' ? 'undo' : 'accept')} style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, padding: '4px 7px', background: 'var(--sv-bg-1)', color: 'var(--sv-text)', cursor: 'pointer' }}>{finding.reviewStatus === 'accepted' ? 'Undo' : 'Accept exception'}</button>}</div></td>
          </tr>)}</tbody>
        </ReportScrollTable>
      )}
    </div>
  );
}