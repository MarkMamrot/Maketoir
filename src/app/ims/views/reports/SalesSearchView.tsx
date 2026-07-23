import React, { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_MULTI,
  MultiFilter,
  ReportMultiFilter,
  WINDOW_OPTS,
  multiFilterParams,
} from './reportFilterHelpers';

interface SalesSearchViewProps {
  onBack: () => void;
  apiFetch: (url: string, opts?: RequestInit) => Promise<any>;
  today: () => string;
  fmtCurrency: (n: number | null | undefined) => string;
}

export function SalesSearchView({ onBack, apiFetch, today, fmtCurrency }: SalesSearchViewProps) {
  const [rows, setRows]       = useState<any[]>([]);
  const [total, setTotal]     = useState(0);
  const [totalQty, setTotalQty]         = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [range, setRange]     = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [q, setQ]           = useState('');
  const [filters, setFilters] = useState<MultiFilter>(EMPTY_MULTI);
  const [days, setDays]     = useState(90);
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [page, setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const totalPages = Math.ceil(total / pageSize) || 1;

  const load = useCallback(async (opts: { q: string; f: MultiFilter; days: number; from: string; to: string; page: number; pageSize: number }) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({
        q: opts.q, days: String(opts.days),
        page: String(opts.page), pageSize: String(opts.pageSize),
        ...multiFilterParams(opts.f),
      });
      if (opts.from) params.set('from', opts.from);
      if (opts.to)   params.set('to', opts.to);
      const data = await apiFetch(`/api/ims/reports/sales-search?${params}`);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setTotalQty(data.totalQty ?? 0);
      setTotalRevenue(data.totalRevenue ?? 0);
      setRange({ from: data.from, to: data.to });
    } catch (e: any) {
      setError(e.message ?? 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load({ q: '', f: EMPTY_MULTI, days: 90, from: '', to: '', page: 1, pageSize: 50 }); }, [load]);

  const run = (over?: Partial<{ page: number }>) => {
    const pg = over?.page ?? 1;
    setPage(pg);
    load({ q, f: filters, days, from, to, page: pg, pageSize });
  };
  const changeWindow = (d: number) => { setDays(d); setFrom(''); setTo(''); setPage(1); load({ q, f: filters, days: d, from: '', to: '', page: 1, pageSize }); };
  const handleFilterChange = (f: MultiFilter) => { setFilters(f); setPage(1); load({ q, f, days, from, to, page: 1, pageSize }); };
  const goPage = (pg: number) => { setPage(pg); load({ q, f: filters, days, from, to, page: pg, pageSize }); };
  const changePageSize = (ps: number) => { setPageSize(ps); setPage(1); load({ q, f: filters, days, from, to, page: 1, pageSize: ps }); };

  const downloadCsv = () => {
    const headers = ['SKU', 'Product', 'Option', 'Brand', 'Supplier', 'Qty', 'POS', 'Online', 'Wholesale', 'History', 'Revenue'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.sku ?? '',
        `"${(r.product_name || '').replace(/"/g, '""')}"`,
        `"${(r.option_label || '').replace(/"/g, '""')}"`,
        `"${(r.brand || '').replace(/"/g, '""')}"`,
        `"${(r.supplier_name || '').replace(/"/g, '""')}"`,
        r.qty, r.pos_qty, r.online_qty, r.wholesale_qty, r.history_qty, r.revenue,
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sales-search-${today()}.csv`; a.click();
  };

  const pageRange = (): (number | '...')[] => {
    const r: (number | '...')[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) r.push(i); }
    else {
      r.push(1);
      if (page > 3) r.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) r.push(i);
      if (page < totalPages - 2) r.push('...');
      r.push(totalPages);
    }
    return r;
  };

  const cellStyle: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid var(--sv-etch)', fontSize: 13, whiteSpace: 'nowrap' };
  const hCell: React.CSSProperties    = { ...cellStyle, fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, background: 'var(--sv-bg-2)' };
  const numCell: React.CSSProperties  = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' as any };
  const numHCell: React.CSSProperties = { ...hCell, textAlign: 'right' };
  const usingCustom = !!(from || to);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Reports
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0 }}>Sales Search</h1>
      </div>

      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(); }}
          placeholder="Search words in product name / SKU…"
          style={{ height: 34, flex: '1 1 240px', minWidth: 200, padding: '0 12px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 13 }}
        />
        <button onClick={() => run()} disabled={loading} style={{ height: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: 'var(--sv-action)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Search</button>
        <ReportMultiFilter filters={filters} onChange={handleFilterChange} />
        <div style={{ display: 'flex', gap: 4 }}>
          {WINDOW_OPTS.map(o => (
            <button key={o.value} onClick={() => changeWindow(o.value)} style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: (!usingCustom && days === o.value) ? 'var(--sv-action)' : 'var(--sv-bg-0)', color: (!usingCustom && days === o.value) ? '#fff' : 'var(--sv-text-main)', fontSize: 12, fontWeight: (!usingCustom && days === o.value) ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>{o.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: usingCustom ? 'var(--sv-bg-0)' : 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }} />
          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ height: 34, padding: '0 8px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: usingCustom ? 'var(--sv-bg-0)' : 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }} />
          {usingCustom && <button onClick={() => run()} disabled={loading} style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: 'pointer' }}>Apply</button>}
        </div>
        <button onClick={downloadCsv} disabled={rows.length === 0} style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: rows.length === 0 ? 'not-allowed' : 'pointer', opacity: rows.length === 0 ? 0.5 : 1 }}>⬇ CSV</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: '1 1 160px', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Units Sold</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{totalQty.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Revenue</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{fmtCurrency(totalRevenue)}</div>
        </div>
        <div style={{ flex: '1 1 160px', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Products</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{total.toLocaleString()}</div>
        </div>
        <div style={{ flex: '1 1 200px', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Period</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sv-text-main)', marginTop: 4 }}>{range ? `${range.from} → ${range.to}` : '—'}</div>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--sv-red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--sv-red) 10%, transparent)', borderRadius: 6 }}>{error}</div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--sv-etch)', borderRadius: 10, background: 'var(--sv-bg-1)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...hCell, position: 'sticky', left: 0, zIndex: 2, background: 'var(--sv-bg-2)', minWidth: 220 }}>Product</th>
              <th style={hCell}>SKU</th>
              <th style={hCell}>Brand</th>
              <th style={hCell}>Supplier</th>
              <th style={{ ...numHCell, color: 'var(--sv-action)' }}>Qty Sold</th>
              <th style={numHCell}>POS</th>
              <th style={numHCell}>Online</th>
              <th style={numHCell}>Wholesale</th>
              <th style={numHCell}>History</th>
              <th style={numHCell}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} style={{ ...cellStyle, textAlign: 'center', padding: '40px 0', color: 'var(--sv-text-dim)' }}>No sales found for this search and period.</td></tr>
            )}
            {!loading && rows.map((row, i) => {
              const rowBg = i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--sv-etch) 35%, transparent)';
              return (
                <tr key={row.variant_id} style={{ background: rowBg }}>
                  <td style={{ ...cellStyle, position: 'sticky', left: 0, zIndex: 1, background: rowBg, minWidth: 220 }}>
                    <div style={{ fontWeight: 500, color: 'var(--sv-text-strong)' }}>{row.product_name}</div>
                    {row.option_label && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 1 }}>{row.option_label}</div>}
                  </td>
                  <td style={{ ...cellStyle, color: 'var(--sv-text-dim)', fontFamily: 'monospace', fontSize: 12 }}>{row.sku || '—'}</td>
                  <td style={cellStyle}>{row.brand || '—'}</td>
                  <td style={cellStyle}>{row.supplier_name || '—'}</td>
                  <td style={{ ...numCell, color: row.qty > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)', fontWeight: 600 }}>{Number(row.qty).toLocaleString('en-AU', { maximumFractionDigits: 0 })}</td>
                  <td style={{ ...numCell, color: row.pos_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', opacity: row.pos_qty > 0 ? 1 : 0.45 }}>{row.pos_qty > 0 ? Number(row.pos_qty).toLocaleString() : '—'}</td>
                  <td style={{ ...numCell, color: row.online_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', opacity: row.online_qty > 0 ? 1 : 0.45 }}>{row.online_qty > 0 ? Number(row.online_qty).toLocaleString() : '—'}</td>
                  <td style={{ ...numCell, color: row.wholesale_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', opacity: row.wholesale_qty > 0 ? 1 : 0.45 }}>{row.wholesale_qty > 0 ? Number(row.wholesale_qty).toLocaleString() : '—'}</td>
                  <td style={{ ...numCell, color: row.history_qty > 0 ? 'var(--sv-text-main)' : 'var(--sv-text-dim)', opacity: row.history_qty > 0 ? 1 : 0.45 }}>{row.history_qty > 0 ? Number(row.history_qty).toLocaleString() : '—'}</td>
                  <td style={{ ...numCell, fontWeight: 500 }}>{fmtCurrency(Number(row.revenue))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => goPage(page - 1)} disabled={page <= 1 || loading} style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontSize: 13, color: 'var(--sv-text-main)' }}>←</button>
            {pageRange().map((p, i) =>
              p === '...'
                ? <span key={`e${i}`} style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 4px' }}>…</span>
                : <button key={p} onClick={() => goPage(p as number)} disabled={loading} style={{ height: 30, minWidth: 30, borderRadius: 6, border: '1px solid var(--sv-etch)', background: p === page ? 'var(--sv-action)' : 'var(--sv-bg-1)', color: p === page ? '#fff' : 'var(--sv-text-main)', fontWeight: p === page ? 600 : 400, cursor: 'pointer', fontSize: 13 }}>{p}</button>
            )}
            <button onClick={() => goPage(page + 1)} disabled={page >= totalPages || loading} style={{ height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontSize: 13, color: 'var(--sv-text-main)' }}>→</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--sv-text-dim)' }}>
            <span>Page {page} of {totalPages} · {total.toLocaleString()} products</span>
            <select value={pageSize} onChange={e => changePageSize(Number(e.target.value))} style={{ height: 28, padding: '0 6px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 12, cursor: 'pointer' }}>
              {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
