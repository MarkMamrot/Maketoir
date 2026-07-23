import React from 'react';

type PosRegisterSession = {
  id: number;
  register_name: string;
  location_name: string;
  location_id: number;
  status: string;
  opened_at: string | null;
  opened_by: string | null;
  opening_float: string | null;
  closed_at: string | null;
  closed_by: string | null;
  reconciliations: {
    payment_method: string;
    expected_amount: number | null;
    counted_amount: number | null;
    variance: number | null;
    xero_invoice_id: string | null;
    xero_synced_at: string | null;
  }[];
  total_expected: number;
  total_counted: number;
  total_variance: number;
};

interface PosRegistersReportViewProps {
  onBack: () => void;
  XeroStatusBadge: React.ComponentType<{ status: string | null }>;
}

export function PosRegistersReportView({ onBack, XeroStatusBadge }: PosRegistersReportViewProps) {
  const todayAest = new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' });

  const [date, setDate] = React.useState(todayAest);
  const [sessions, setSessions] = React.useState<PosRegisterSession[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [fetched, setFetched] = React.useState(false);

  async function run() {
    setLoading(true);
    setFetched(false);
    try {
      const res = await fetch(`/api/ims/reports/pos-registers?date=${date}`);
      const j = await res.json();
      setSessions(j.sessions ?? []);
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

  function exportCsv() {
    const rows: string[][] = [
      ['Location', 'Register', 'Status', 'Opened At', 'Opened By', 'Opening Float',
       'Closed At', 'Closed By', 'Payment Method', 'Expected', 'Counted', 'Variance',
       'Xero Invoice', 'Xero Synced'],
    ];
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
        rows.push([...base, '', '', '', '', '', '']);
      } else {
        for (const r of s.reconciliations) {
          rows.push([
            ...base,
            r.payment_method,
            r.expected_amount?.toFixed(2) ?? '',
            r.counted_amount?.toFixed(2) ?? '',
            r.variance?.toFixed(2) ?? '',
            r.xero_invoice_id ?? '',
            r.xero_synced_at ? fmtDt(r.xero_synced_at) : '',
          ]);
        }
        rows.push([
          ...base,
          'TOTAL',
          s.total_expected.toFixed(2),
          s.total_counted.toFixed(2),
          s.total_variance.toFixed(2),
          '', '',
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

      {fetched && sessions.length === 0 && (
        <div style={{ color: 'var(--sv-text-muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
          No register sessions found for {date}.
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--sv-bg-subtle)' }}>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Register</th>
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
                <th style={thStyle}>Xero</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const isOpen = s.status === 'open';
                const rowBg = isOpen ? 'rgba(16,185,129,0.04)' : undefined;
                const hasRecons = s.reconciliations.length > 0;
                const reconRows = hasRecons ? s.reconciliations.length + 1 : 1;

                return (
                  <React.Fragment key={s.id}>
                    <tr style={{ background: rowBg }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }} rowSpan={reconRows}>{s.location_name}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }} rowSpan={reconRows}>{s.register_name}</td>
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
                      <td style={tdStyle} rowSpan={reconRows}>{fmt$(s.opening_float != null ? parseFloat(s.opening_float) : null)}</td>
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
                          <td style={tdStyle}>
                            {s.reconciliations[0].xero_invoice_id ? (
                              <a href={xeroLink(s.reconciliations[0].xero_invoice_id)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                <XeroStatusBadge status="success" />
                              </a>
                            ) : (
                              <XeroStatusBadge status={null} />
                            )}
                          </td>
                        </>
                      ) : (
                        <td style={{ ...tdStyle, color: 'var(--sv-text-muted)' }} colSpan={5}>No reconciliation data</td>
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
                        <td style={tdStyle}>
                          {r.xero_invoice_id ? (
                            <a href={xeroLink(r.xero_invoice_id)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                              <XeroStatusBadge status="success" />
                            </a>
                          ) : (
                            <XeroStatusBadge status={null} />
                          )}
                        </td>
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
                        <td style={tdStyle} />
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
