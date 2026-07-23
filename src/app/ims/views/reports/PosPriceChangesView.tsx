import React, { useEffect, useState } from 'react';

interface PosPriceChangesViewProps {
  onBack: () => void;
  btnStyle: (variant: any, size?: any) => React.CSSProperties;
}

export function PosPriceChangesView({ onBack, btnStyle }: PosPriceChangesViewProps) {
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo]   = useState(() => new Date().toISOString().slice(0, 10));

  const load = async (from: string, to: string) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/ims/reports/pos-price-changes?from=${from}&to=${to}`);
      const d = await res.json();
      if (d.success) setRows(d.data ?? []);
      else setError(d.error ?? 'Unknown error');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  useEffect(() => { load(dateFrom, dateTo); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtMoney = (n: any) => `$${Number(n).toFixed(2)}`;
  const cellStyle: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13 };
  const hCell: React.CSSProperties     = { ...cellStyle, fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase' as any, letterSpacing: 0.6, background: 'var(--sv-bg-2)' };
  const numCell: React.CSSProperties   = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' as any };
  const numHCell: React.CSSProperties  = { ...hCell, textAlign: 'right' };

  const downloadCsv = () => {
    const headers = ['Date', 'Time', 'Location', 'Cashier', 'Sale #', 'Item', 'SKU', 'Original Price', 'Changed To'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const dt = new Date(r.completed_at);
      lines.push([
        dt.toLocaleDateString('en-AU'),
        dt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }),
        `"${(r.location_name || '').replace(/"/g, '""')}"`,
        `"${(r.cashier_name || '').replace(/"/g, '""')}"`,
        r.sale_id,
        `"${(r.item_name || '').replace(/"/g, '""')}"`,
        `"${(r.item_code || '').replace(/"/g, '""')}"`,
        Number(r.original_price).toFixed(2),
        Number(r.unit_price).toFixed(2),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pos-price-changes-${dateFrom}-${dateTo}.csv`; a.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Reports
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>POS Price Changed Transactions</h1>
        <button onClick={downloadCsv} disabled={rows.length === 0} style={btnStyle('ghost', 'sm')}>⬇ Export CSV</button>
      </div>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>From</label>
        <input type='date' value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', color: 'inherit', fontSize: 13 }} />
        <label style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>To</label>
        <input type='date' value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', color: 'inherit', fontSize: 13 }} />
        <button onClick={() => load(dateFrom, dateTo)} style={btnStyle('action', 'sm')}>Search</button>
        <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', marginLeft: 'auto' }}>{rows.length} result{rows.length !== 1 ? 's' : ''}</span>
      </div>
      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading…</div>}
      {error && <div style={{ padding: 16, color: 'var(--sv-red)' }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No price changes found in this date range.</div>
      )}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--sv-etch)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--sv-bg-1)' }}>
            <thead>
              <tr>
                <th style={hCell}>Date</th>
                <th style={hCell}>Time</th>
                <th style={hCell}>Location</th>
                <th style={hCell}>Cashier</th>
                <th style={hCell}>Sale #</th>
                <th style={hCell}>Item</th>
                <th style={hCell}>SKU</th>
                <th style={numHCell}>Original Price</th>
                <th style={numHCell}>Changed To</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const dt = new Date(r.completed_at);
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.03)' }}>
                    <td style={cellStyle}>{dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={cellStyle}>{dt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                    <td style={cellStyle}>{r.location_name || '—'}</td>
                    <td style={cellStyle}>{r.cashier_name || '—'}</td>
                    <td style={cellStyle}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--sv-action)' }}>#{r.sale_id}</span>
                    </td>
                    <td style={cellStyle}>{r.item_name}</td>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 12, color: 'var(--sv-text-dim)' }}>{r.item_code || '—'}</td>
                    <td style={{ ...numCell, color: 'var(--sv-text-dim)', textDecoration: 'line-through' }}>{fmtMoney(r.original_price)}</td>
                    <td style={{ ...numCell, color: '#fb923c', fontWeight: 700 }}>{fmtMoney(r.unit_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
