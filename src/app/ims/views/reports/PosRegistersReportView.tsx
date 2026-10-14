import React from 'react';
import { ReportScrollTable } from './ReportScrollTable';

type PosRegisterSession = {
  id: number;
  register_name: string;
  location_name: string;
  location_id: number;
  status: string;
  opened_at: string | null;
  opened_by: string | null;
  opening_float: string | null;
  latest_correction?: {
    id: number; session_status: string; email_sent_at: string | null;
    previous_float: string | null; opening_float: string; reason: string; actor_name: string; created_at: string;
  } | null;
  closed_at: string | null;
  closed_by: string | null;
  reconciliations: {
    payment_method: string;
    expected_amount: number | null;
    counted_amount: number | null;
    variance: number | null;
    xero_invoice_id: string | null;
    xero_synced_at: string | null;
    till_variance: number | null;
    variance_status: string | null;
    xero_variance_id: string | null;
  }[];
  total_expected: number;
  total_counted: number;
  total_variance: number;
};

interface PosRegistersReportViewProps {
  onBack: () => void;
  xeroAccountingEnabled: boolean;
  canEditFloat?: boolean;
  XeroStatusBadge: React.ComponentType<{ status: string | null }>;
}

export function PosRegistersReportView({ onBack, xeroAccountingEnabled, canEditFloat = false, XeroStatusBadge }: PosRegistersReportViewProps) {
  const defaultDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' });

  const [date, setDate] = React.useState(defaultDate);
  const [sessions, setSessions] = React.useState<PosRegisterSession[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [fetched, setFetched] = React.useState(false);
  const [error, setError] = React.useState('');
  const [editing, setEditing] = React.useState<PosRegisterSession | null>(null);
  const [float, setFloat] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [modalError, setModalError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [recipients, setRecipients] = React.useState<string[]>([]);
  const [savedCorrection, setSavedCorrection] = React.useState<number | null>(null);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const editButtonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!editing) return;
    dialogRef.current?.showModal();
    let active = true;
    fetch('/api/ims/settings/accounts').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Accounts recipients could not be loaded.');
      if (active) setRecipients(result.recipients);
    }).catch(error => { if (active) setModalError(error instanceof Error ? error.message : 'Accounts recipients could not be loaded.'); });
    return () => { active = false; };
  }, [editing]);

  function closeEditor() {
    if (busy) return;
    dialogRef.current?.close();
    setEditing(null);
    editButtonRef.current?.focus();
  }

  function edit(session: PosRegisterSession, button: HTMLButtonElement) {
    editButtonRef.current = button;
    setFloat(session.opening_float ?? '');
    setReason(''); setAcknowledged(false); setModalError(''); setNotice(''); setRecipients([]);
    setSavedCorrection(null); setEditing(session);
  }

  async function saveFloat() {
    if (!editing) return;
    setBusy(true); setModalError('');
    try {
      const response = await fetch('/api/ims/reports/pos-registers/float', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: editing.id, status: editing.status, previousFloat: editing.opening_float,
          openingFloat: float, reason, acknowledgeAccounting: acknowledged }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Float correction failed.');
      setSavedCorrection(result.correctionId);
      setNotice('Opening float corrected. No accounting sync was triggered.');
      await run();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Float correction failed.');
    } finally { setBusy(false); }
  }

  async function emailBookkeeper(correctionId: number) {
    setBusy(true); setModalError('');
    try {
      const response = await fetch('/api/ims/reports/pos-registers/float', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Bookkeeper email failed.');
      setNotice(result.alreadySent ? 'This correction has already been emailed.' : 'Correction emailed to the bookkeeper/accounts recipients.');
      await run();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Bookkeeper email failed.');
    } finally { setBusy(false); }
  }

  React.useEffect(() => {
    fetch('/api/ims/settings')
      .then(response => response.json())
      .then(result => {
        const timeZone = result?.data?.business_timezone || 'Australia/Sydney';
        setDate(new Date().toLocaleDateString('sv-SE', { timeZone }));
      })
      .catch(() => {});
  }, []);

  async function run() {
    setLoading(true);
    setFetched(false);
    setError('');
    try {
      const res = await fetch(`/api/ims/reports/pos-registers?date=${date}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Register report could not be loaded.');
      setSessions(j.sessions ?? []);
    } catch (error) {
      setSessions([]);
      setError(error instanceof Error ? error.message : 'Register report could not be loaded.');
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }

  React.useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt$ = (v: number | null) =>
    v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });

  const fmtDt = (v: string | null) => {
    if (!v) return '—';
    const [datePart = '', timePart = ''] = v.replace('T', ' ').split(' ');
    const [y = '', m = '', d = ''] = datePart.split('-');
    const [h = '0', min = '00'] = timePart.split(':');
    const hour = parseInt(h, 10);
    return `${d}/${m}/${y}, ${hour % 12 || 12}:${min} ${hour >= 12 ? 'pm' : 'am'}`;
  };

  const varColor = (v: number | null) => {
    if (v == null || v === 0) return undefined;
    return v > 0 ? 'var(--sv-mint)' : 'var(--sv-red)';
  };

  function xeroLink(id: string) {
    return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${id}`;
  }

  function xeroBankTransactionLink(id: string) {
    return `https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=${id}`;
  }

  function renderXeroDocuments(reconciliation: PosRegisterSession['reconciliations'][number]) {
    const hasVariance = reconciliation.till_variance != null && reconciliation.till_variance !== 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        {reconciliation.xero_invoice_id ? (
          <a href={xeroLink(reconciliation.xero_invoice_id)} target="_blank" rel="noopener noreferrer" title="Open EOD invoice in Xero" style={{ textDecoration: 'none' }}>
            <XeroStatusBadge status="success" />
          </a>
        ) : (
          <XeroStatusBadge status={null} />
        )}
        {hasVariance && (
          reconciliation.xero_variance_id ? (
            <a
              href={xeroBankTransactionLink(reconciliation.xero_variance_id)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open till ${reconciliation.till_variance! < 0 ? 'shortage' : 'overage'} ${fmt$(Math.abs(reconciliation.till_variance!))} in Xero`}
              style={{ color: reconciliation.till_variance! < 0 ? 'var(--sv-red)' : 'var(--sv-mint)', fontSize: 11, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              ↗ Till {reconciliation.till_variance! < 0 ? 'Short' : 'Over'}
            </a>
          ) : (
            <span style={{ color: reconciliation.variance_status === 'error' ? 'var(--sv-red)' : 'var(--sv-text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
              Till {reconciliation.till_variance! < 0 ? 'shortage' : 'overage'} {fmt$(Math.abs(reconciliation.till_variance!))} · {reconciliation.variance_status ?? 'not posted'}
            </span>
          )
        )}
      </div>
    );
  }

  function exportCsv() {
    const rows: string[][] = [[
      'Location', 'Register', 'Status', 'Opened At', 'Opened By', 'Opening Float',
      'Closed At', 'Closed By', 'Payment Method', 'Expected', 'Counted', 'Variance',
      ...(xeroAccountingEnabled ? ['Xero Invoice', 'Xero Synced', 'Till Variance', 'Variance Status', 'Xero Variance'] : []),
    ]];
    for (const s of sessions) {
      const base = [
        s.location_name, s.register_name, s.status,
        s.opened_at ? fmtDt(s.opened_at) : '',
        s.opened_by ?? '',
        s.opening_float ?? '',
        s.closed_at ? fmtDt(s.closed_at) : '',
        s.closed_by ?? '',
      ];
      if (s.reconciliations.length === 0) {
        rows.push([...base, '', '', '', '', ...(xeroAccountingEnabled ? ['', '', '', '', ''] : [])]);
      } else {
        for (const r of s.reconciliations) {
          rows.push([
            ...base,
            r.payment_method,
            r.expected_amount?.toFixed(2) ?? '',
            r.counted_amount?.toFixed(2) ?? '',
            r.variance?.toFixed(2) ?? '',
            ...(xeroAccountingEnabled ? [
              r.xero_invoice_id ?? '',
              r.xero_synced_at ? fmtDt(r.xero_synced_at) : '',
              r.till_variance?.toFixed(2) ?? '',
              r.variance_status ?? '',
              r.xero_variance_id ?? '',
            ] : []),
          ]);
        }
        rows.push([
          ...base,
          'TOTAL',
          s.total_expected.toFixed(2),
          s.total_counted.toFixed(2),
          s.total_variance.toFixed(2),
          ...(xeroAccountingEnabled ? ['', '', '', '', ''] : []),
        ]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pos-registers-${date}.csv`;
    a.click();
  }

  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '6px 10px',
    fontSize: 11, fontWeight: 600, color: 'var(--sv-text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid var(--sv-border)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: 13,
    borderBottom: '1px solid var(--sv-border)',
    verticalAlign: 'middle',
  };
  const columnWidths = [150, 140, 100, 170, 130, 170, 170, 130, 150, 120, 120, 120, ...(xeroAccountingEnabled ? [100] : [])];
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const renderColGroup = () => <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-text-muted)', fontSize: 20, lineHeight: 1, padding: 0 }}
        >‹</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)' }}>
          Daily POS Registers Report
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--sv-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--sv-border)', fontSize: 13, background: 'var(--sv-bg-card)', color: 'var(--sv-text-strong)' }}
          />
        </div>
        <button
          onClick={run}
          disabled={loading}
          style={{ padding: '8px 18px', background: 'var(--sv-accent)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
        >{loading ? 'Loading…' : 'Run'}</button>
        {fetched && sessions.length > 0 && (
          <button
            onClick={exportCsv}
            style={{ padding: '8px 16px', background: 'none', color: 'var(--sv-accent)', border: '1px solid var(--sv-accent)', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >Export CSV</button>
        )}
      </div>

      {error && <p role="alert" style={{ color: 'var(--sv-red)' }}>{error}</p>}
      {fetched && !error && sessions.length === 0 && (
        <div style={{ color: 'var(--sv-text-muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
          No register sessions found for {date}.
        </div>
      )}

      {sessions.length > 0 && (
        <ReportScrollTable
          ariaLabel="Daily POS registers table. Use arrow keys to scroll."
          bodyClassName="pos-registers-table-scroll"
          tableWidth={tableWidth}
          renderColGroup={renderColGroup}
          headerRows={
              <tr style={{ background: 'var(--sv-bg-subtle)' }}>
                <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 4, background: 'var(--sv-bg-2)' }}>Location</th>
                <th style={{ ...thStyle, position: 'sticky', left: 150, zIndex: 4, background: 'var(--sv-bg-2)', boxShadow: '1px 0 0 var(--sv-etch)' }}>Register</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Opened</th>
                <th style={thStyle}>Opened By</th>
                <th style={thStyle}>Float</th>
                <th style={thStyle}>Closed</th>
                <th style={thStyle}>Closed By</th>
                <th style={thStyle}>Payment Method</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Expected</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Counted</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Variance</th>
                {xeroAccountingEnabled && <th style={thStyle}>Xero</th>}
              </tr>
          }
        >
            <tbody>
              {sessions.map(s => {
                const isOpen = s.status === 'open';
                const rowBg = isOpen ? 'color-mix(in srgb, var(--sv-mint) 4%, var(--sv-bg-1))' : 'var(--sv-bg-1)';
                const hasRecons = s.reconciliations.length > 0;
                const reconRows = hasRecons ? s.reconciliations.length + 1 : 1;

                return (
                  <React.Fragment key={s.id}>
                    <tr style={{ background: rowBg }}>
                      <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: rowBg, fontWeight: 600 }} rowSpan={reconRows}>{s.location_name}</td>
                      <td style={{ ...tdStyle, position: 'sticky', left: 150, zIndex: 1, background: rowBg, fontWeight: 600, boxShadow: '1px 0 0 var(--sv-etch)' }} rowSpan={reconRows}>{s.register_name}</td>
                      <td style={tdStyle} rowSpan={reconRows}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                          background: isOpen ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                          color: isOpen ? 'var(--sv-mint)' : 'var(--sv-red)',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOpen ? 'var(--sv-mint)' : 'var(--sv-red)' }} />
                          {isOpen ? 'Open' : 'Closed'}
                        </span>
                      </td>
                      <td style={tdStyle} rowSpan={reconRows}>{fmtDt(s.opened_at)}</td>
                      <td style={{ ...tdStyle, color: 'var(--sv-text-muted)' }} rowSpan={reconRows}>{s.opened_by ?? '—'}</td>
                      <td style={tdStyle} rowSpan={reconRows}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {fmt$(s.opening_float != null ? parseFloat(s.opening_float) : null)}
                          {canEditFloat && <button type="button" aria-label={`Edit opening float for ${s.location_name} ${s.register_name}`} onClick={event => edit(s, event.currentTarget)}>Edit</button>}
                        </div>
                        {s.latest_correction && <small title={`${s.latest_correction.actor_name}: ${s.latest_correction.reason}`}>
                          Corrected{ s.latest_correction.session_status === 'closed' ? (s.latest_correction.email_sent_at ? ' - accounts emailed' : ' - accounts not emailed') : ''}
                        </small>}
                      </td>
                      <td style={tdStyle} rowSpan={reconRows}>{fmtDt(s.closed_at)}</td>
                      <td style={{ ...tdStyle, color: 'var(--sv-text-muted)' }} rowSpan={reconRows}>{s.closed_by ?? '—'}</td>

                      {hasRecons ? (
                        <>
                          <td style={tdStyle}>{s.reconciliations[0].payment_method}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(s.reconciliations[0].expected_amount)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(s.reconciliations[0].counted_amount)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: varColor(s.reconciliations[0].variance) }}>
                            {s.reconciliations[0].variance != null ? (s.reconciliations[0].variance >= 0 ? '+' : '') + fmt$(s.reconciliations[0].variance) : '—'}
                          </td>
                          {xeroAccountingEnabled && <td style={tdStyle}>{renderXeroDocuments(s.reconciliations[0])}</td>}
                        </>
                      ) : (
                        <td style={{ ...tdStyle, color: 'var(--sv-text-muted)' }} colSpan={xeroAccountingEnabled ? 5 : 4}>No reconciliation data</td>
                      )}
                    </tr>

                    {s.reconciliations.slice(1).map(r => (
                      <tr key={r.payment_method} style={{ background: rowBg }}>
                        <td style={tdStyle}>{r.payment_method}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(r.expected_amount)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt$(r.counted_amount)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: varColor(r.variance) }}>
                          {r.variance != null ? (r.variance >= 0 ? '+' : '') + fmt$(r.variance) : '—'}
                        </td>
                        {xeroAccountingEnabled && <td style={tdStyle}>{renderXeroDocuments(r)}</td>}
                      </tr>
                    ))}

                    {hasRecons && (
                      <tr style={{ background: rowBg }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--sv-text-muted)', fontStyle: 'italic' }}>TOTAL</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt$(s.total_expected)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt$(s.total_counted)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: varColor(s.total_variance) }}>
                          {(s.total_variance >= 0 ? '+' : '') + fmt$(s.total_variance)}
                        </td>
                        {xeroAccountingEnabled && <td style={tdStyle} />}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
        </ReportScrollTable>
      )}
      {editing && <dialog ref={dialogRef} aria-labelledby="float-dialog-title" onCancel={event => { event.preventDefault(); closeEditor(); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); } }}
        style={{ width: 480, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', boxSizing: 'border-box', border: '1px solid var(--sv-border)', borderRadius: 12, padding: 24, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)' }}>
        <h2 id="float-dialog-title" style={{ marginTop: 0 }}>Edit opening float</h2>
        <p>{editing.location_name} / {editing.register_name} - {editing.status}</p>
        <p>Recorded float: {fmt$(editing.opening_float == null ? null : Number(editing.opening_float))}</p>
        {editing.status === 'closed' && <div role="note" style={{ padding: 12, border: '1px solid var(--sv-amber)', borderRadius: 6 }}>
          <strong>Manual accounting correction required</strong>
          <p>Cash variance will be recalculated in Solvantis. Counted cash and sales stay unchanged. Any affected sync to Xero or other accounting software must be edited manually by the bookkeeper. Saving does not sync or resend accounting documents.</p>
          {!savedCorrection && <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand the bookkeeper must correct affected accounting entries manually.</label>}
        </div>}
        {!savedCorrection && <form onSubmit={event => { event.preventDefault(); void saveFloat(); }}>
          <label style={{ display: 'block', marginTop: 16 }}>Opening float ($)
            <input autoFocus type="number" min="0" max="9999999999.99" step="0.01" required value={float} disabled={busy} onChange={event => setFloat(event.target.value)} style={{ display: 'block', padding: 8, marginTop: 4 }} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>Reason for correction
            <textarea required maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4 }} />
          </label>
          <p>The original opening denomination breakdown will be cleared because it no longer matches the corrected float.</p>
          <button type="submit" disabled={busy || (editing.status === 'closed' && !acknowledged)}>{busy ? 'Saving...' : 'Save opening float'}</button>
        </form>}
        {editing.latest_correction && <p>Last correction: {fmt$(editing.latest_correction.previous_float == null ? null : Number(editing.latest_correction.previous_float))} to {fmt$(Number(editing.latest_correction.opening_float))}, by {editing.latest_correction.actor_name}. Reason: {editing.latest_correction.reason}</p>}
        {editing.status === 'closed' && <div style={{ marginTop: 16 }}>
          <p>{recipients.length ? `Bookkeeping/accounts recipients: ${recipients.join(', ')}` : 'No accounts recipients loaded. Configure Bookkeeping / Accounts email in General Settings.'}</p>
          {(savedCorrection || editing.latest_correction?.session_status === 'closed') && <button type="button" disabled={busy || !recipients.length}
            onClick={() => emailBookkeeper(savedCorrection ?? editing.latest_correction!.id)}>Email bookkeeper about {savedCorrection ? 'this' : 'last'} correction</button>}
          {!savedCorrection && !editing.latest_correction && <p>Save the correction first to email its details.</p>}
        </div>}
        {notice && <p role="status">{notice}</p>}
        {modalError && <p role="alert" style={{ color: 'var(--sv-red)' }}>{modalError}</p>}
        <button type="button" disabled={busy} onClick={closeEditor} style={{ marginTop: 16 }}>Close</button>
      </dialog>}
    </div>
  );
}
