import React, { useCallback, useEffect, useState } from 'react';

const PAGE_SIZE = 100;

interface StockViewProps {
  inputStyle: React.CSSProperties;
  btnStyle: (variant: any, size?: any) => React.CSSProperties;
  Spinner: React.ComponentType<any>;
  EmptyState: React.ComponentType<{ text: string }>;
  fmtCurrency: (n: number | null | undefined) => string;
  fmtQty: (n: number | null | undefined) => string;
}

export function StockView({
  inputStyle,
  btnStyle,
  Spinner,
  EmptyState,
  fmtCurrency,
  fmtQty,
}: StockViewProps) {
  const [stock, setStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortCol, setSortCol] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [showZoneBin, setShowZoneBin] = useState(true);

  useEffect(() => {
    fetch('/api/ims/settings').then(r => r.json()).then(d => {
      const s = d?.data ?? {};
      setShowZoneBin(s.use_zones_bins !== 'no');
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/ims/stock').then(r => r.json()).then(d => {
      if (d.success) setStock(d.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const brandOptions    = [...new Set(stock.map((s: any) => s.brand).filter(Boolean))].sort() as string[];
  const supplierOptions = [...new Set(
    stock.filter((s: any) => s.supplier_is_active !== 0).map((s: any) => s.supplier_name).filter(Boolean)
  )].sort() as string[];

  const filtered = stock.filter((s: any) => {
    if (filterBrand && !(s.brand || '').toLowerCase().includes(filterBrand.toLowerCase())) return false;
    if (filterSupplier && !(s.supplier_name || '').toLowerCase().includes(filterSupplier.toLowerCase())) return false;
    // min_qty = 0 means "flag when out of stock".
    if (showLowOnly && !(Number(s.qty_on_hand) <= Number(s.min_qty))) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (!(s.sku || '').toLowerCase().includes(q) &&
          !(s.barcode || '').toLowerCase().includes(q) &&
          !(s.product_name || '').toLowerCase().includes(q) &&
          !(s.variant_label || '').toLowerCase().includes(q) &&
          !(s.location_name || '').toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalSOH       = sorted.reduce((acc: number, r: any) => acc + Number(r.qty_on_hand || 0), 0);
  const totalAvailable = sorted.reduce((acc: number, r: any) => acc + (Number(r.qty_on_hand || 0) - Number(r.qty_committed || 0)), 0);
  const totalValue     = sorted.reduce((acc: number, r: any) => acc + Number(r.qty_on_hand || 0) * Number(r.avg_cost || 0), 0);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const visible    = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: string }) => sortCol !== col ? null : (
    <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  );

  const thStyle = (col: string): React.CSSProperties => ({
    padding: '10px 12px', textAlign: 'left', fontSize: 11,
    color: sortCol === col ? 'var(--sv-text-main)' : 'var(--sv-text-dim)',
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8,
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  });

  const thStyleFixed: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontSize: 11,
    color: 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: .8, whiteSpace: 'nowrap',
  };

  const anyFilter = filter || filterBrand || filterSupplier || showLowOnly;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Stock Levels</h1>
      </div>

      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Search SKU, product or location…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(1); }}
          style={{ ...inputStyle, minWidth: 220, flex: '1 1 220px' }}
        />
        <input
          list="stock-brand-list"
          placeholder="Filter by brand…"
          value={filterBrand}
          onChange={e => { setFilterBrand(e.target.value); setPage(1); }}
          style={{ ...inputStyle, minWidth: 150, flex: '1 1 150px' }}
        />
        <datalist id="stock-brand-list">
          {brandOptions.map(b => <option key={b} value={b} />)}
        </datalist>
        <input
          list="stock-supplier-list"
          placeholder="Filter by supplier…"
          value={filterSupplier}
          onChange={e => { setFilterSupplier(e.target.value); setPage(1); }}
          style={{ ...inputStyle, minWidth: 150, flex: '1 1 150px' }}
        />
        <datalist id="stock-supplier-list">
          {supplierOptions.map(s => <option key={s} value={s} />)}
        </datalist>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sv-text-dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showLowOnly} onChange={e => { setShowLowOnly(e.target.checked); setPage(1); }} />
          Low stock only
        </label>
        {anyFilter && (
          <button onClick={() => { setFilter(''); setFilterBrand(''); setFilterSupplier(''); setShowLowOnly(false); setPage(1); }} style={btnStyle('secondary', 'sm')}>Clear filters</button>
        )}
      </div>

      {loading ? <Spinner /> : sorted.length === 0 ? <EmptyState text="No stock records match your filters." /> : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '4px 12px' }}>
              <strong style={{ color: 'var(--sv-text-main)' }}>{sorted.length.toLocaleString()}</strong> lines
            </span>
            <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '4px 12px' }}>
              Total SOH: <strong style={{ color: 'var(--sv-text-main)' }}>{totalSOH.toLocaleString()}</strong> units
            </span>
            <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '4px 12px' }}>
              Total Available: <strong style={{ color: 'var(--sv-mint)' }}>{totalAvailable.toLocaleString()}</strong> units
            </span>
            <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '4px 12px' }}>
              Total Value: <strong style={{ color: 'var(--sv-mint)' }}>{fmtCurrency(totalValue)}</strong>
            </span>
          </div>

          <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)' }}>
                    {([
                      ['sku','SKU'],['product_name','Product'],['variant_label','Variant'],
                      ['location_name','Location'],
                      ...(showZoneBin ? [['zone','Zone'],['bin','Bin']] as [string,string][] : []),
                    ] as [string,string][]).map(([col, label]) => (
                      <th key={col} onClick={() => toggleSort(col)} style={thStyle(col)}>
                        {label}<SortIcon col={col} />
                      </th>
                    ))}
                    <th onClick={() => toggleSort('qty_on_hand')} style={{ ...thStyle('qty_on_hand'), textAlign: 'right' }}>On Hand<SortIcon col="qty_on_hand" /></th>
                    <th style={{ ...thStyleFixed, textAlign: 'right' }}>Available</th>
                    {(['qty_incoming','qty_committed','min_qty','reorder_qty'] as string[]).map(col => (
                      <th key={col} onClick={() => toggleSort(col)} style={{ ...thStyle(col), textAlign: 'right' }}>
                        {col === 'qty_incoming' ? 'Incoming' : col === 'qty_committed' ? 'Committed' : col === 'min_qty' ? 'Min Qty' : 'Reorder Qty'}
                        <SortIcon col={col} />
                      </th>
                    ))}
                    <th style={{ ...thStyleFixed, textAlign: 'right' }}>Avg Cost</th>
                    <th style={{ ...thStyleFixed, textAlign: 'right' }}>Stock Value</th>
                    {(['brand','supplier_name'] as string[]).map(col => (
                      <th key={col} onClick={() => toggleSort(col)} style={thStyle(col)}>
                        {col === 'brand' ? 'Brand' : 'Supplier'}<SortIcon col={col} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s: any, i: number) => {
                    const low = Number(s.qty_on_hand) <= Number(s.min_qty);
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--sv-etch)', background: i % 2 === 1 ? 'color-mix(in srgb, var(--sv-etch) 35%, transparent)' : undefined }}>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}><code style={{ color: 'var(--sv-mint)', fontSize: 12 }}>{s.sku || '—'}</code></td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-main)', whiteSpace: 'nowrap' }}>{s.product_name}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.variant_label || 'Default'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.location_name}</td>
                        {showZoneBin && <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.zone || '—'}</td>}
                        {showZoneBin && <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.bin || '—'}</td>}
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', color: low ? 'var(--sv-red)' : 'inherit', fontWeight: low ? 700 : 400 }}>{fmtQty(s.qty_on_hand)}</td>
                        {(() => { const av = Number(s.qty_on_hand) - Number(s.qty_committed || 0); return (
                          <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: av <= 0 ? 'var(--sv-red)' : 'var(--sv-mint)' }}>{fmtQty(av)}</td>
                        ); })()}
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{fmtQty(s.qty_incoming)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{fmtQty(s.qty_committed)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{fmtQty(s.min_qty)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', color: 'var(--sv-text-dim)' }}>{fmtQty(s.reorder_qty)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{fmtCurrency(s.avg_cost)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{fmtCurrency(Number(s.qty_on_hand) * Number(s.avg_cost || 0))}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.brand || '—'}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{s.supplier_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <button onClick={() => setPage(1)} disabled={safePage === 1} style={btnStyle('secondary', 'sm')}>«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={btnStyle('secondary', 'sm')}>‹ Prev</button>
              <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 8px' }}>Page {safePage} of {totalPages} ({sorted.length} rows)</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={btnStyle('secondary', 'sm')}>Next ›</button>
              <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} style={btnStyle('secondary', 'sm')}>»</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
