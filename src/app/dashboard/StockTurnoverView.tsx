'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TurnoverRow {
  optionId:      string;
  productId:     string;
  code:          string;
  name:          string;
  brand:         string;
  supplierId:    string;
  supplierName:  string;
  soh:           number;
  cost:          number;
  price:         number | null;
  salesQty:      number;
  avgDailySales: number;
  dos:           number;
  dosRaw:        number;
  turnRate:      number;
  capitalTied:   number;
  capitalEff:    number | null;
  orderWindowDays:   number;
  excessStock:       number;
  excessCapital:     number;
  daysToClearExcess: number;
  daysToClearRaw:    number;
  deadCapitalYears:  number;
  rating:            string;
  ratingRank:        number;
  label:             string;
}

interface TurnoverResponse {
  success:  boolean;
  error?:   string;
  rows?:    TurnoverRow[];
  options?: { brands: string[]; suppliers: { id: string; label: string }[] };
  summary?: {
    totalProducts:    number;
    movingProducts:   number;
    noMovementCount:  number;
    totalCapitalTied: number;
    totalExcessCapital: number;
    totalSales:       number;
    avgDos:           number;
    avgTurnRate:      number;
    worstName:        string;
    worstExcessCapital: number;
    worstDaysToClear: number;
  };
}

type SortField = 'deadCapitalYears' | 'excessCapital' | 'excessStock' | 'daysToClearExcess' | 'capitalTied' | 'dos' | 'turnRate' | 'capitalEff' | 'soh' | 'salesQty' | 'name';

interface SalesDetailRow {
  channel:   'pos' | 'wholesale' | 'online' | 'history';
  date:      string | null;
  qty:       number;
  status:    string;
  reference: string;
  linkedBy:  'variant_id' | 'sku' | 'cin7_option_id';
  counted:   boolean;
  note:      string;
}

interface SalesDetailResponse {
  success: boolean;
  error?:  string;
  variant?: { variantId: string; sku: string | null; cin7OptionId: number | null; name: string };
  cache?:  { sales_qty_7d: number; sales_qty_90d: number; sales_qty_180d: number; sales_qty_12m: number; updated_at: string | null } | null;
  rows?:   SalesDetailRow[];
  totals?: { counted: number; uncounted: number; pos: number; wholesale: number; online: number; history: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Clearance-priority rating buckets (worst → best).
const RATING_ORDER = ['critical', 'high', 'moderate', 'low', 'healthy'] as const;

const RATING_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high:     'bg-orange-100 text-orange-800',
  moderate: 'bg-yellow-100 text-yellow-800',
  low:      'bg-green-100 text-green-800',
  healthy:  'bg-emerald-100 text-emerald-800',
};

const RATING_LABELS: Record<string, string> = {
  critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low', healthy: 'Healthy',
};

const CHANNEL_COLORS: Record<string, string> = {
  pos:       'bg-purple-100 text-purple-800',
  wholesale: 'bg-blue-100 text-blue-800',
  online:    'bg-teal-100 text-teal-800',
  history:   'bg-gray-100 text-gray-500',
};

const CHANNEL_LABELS: Record<string, string> = {
  pos: 'POS', wholesale: 'Wholesale', online: 'Online', history: 'Cin7 hist',
};

function fmt$(v: number): string {
  return v >= 1000
    ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toFixed(0)}`;
}

function fmtDos(dos: number, raw: number): string {
  if (!isFinite(raw) || raw >= 999) return '999+';
  return dos.toFixed(0);
}

function fmtClear(days: number, raw: number): string {
  if (!isFinite(raw) || raw >= 999) return '999+';
  return days.toFixed(0);
}

const WINDOW_OPTIONS = [7, 90, 180, 365] as const;

function downloadCsv(rows: TurnoverRow[]) {
  const headers = ['Code','Name','Brand','Supplier','SOH','Cost','Capital Tied','Sales Qty','Avg Daily Sales','DOS','Turn Rate','Capital Efficiency','Order Freq (days)','Excess Qty','Excess Capital','Days to Clear','Dead Capital-Years','Rating'];
  const lines = [headers.join(','), ...rows.map(r => [
    r.code, `"${r.name.replace(/"/g, '""')}"`, r.brand, `"${r.supplierName.replace(/"/g, '""')}"`,
    r.soh, r.cost, r.capitalTied, r.salesQty, r.avgDailySales,
    isFinite(r.dosRaw) && r.dosRaw < 999 ? r.dos : '999+',
    r.turnRate, r.capitalEff ?? '', r.orderWindowDays, r.excessStock, r.excessCapital,
    isFinite(r.daysToClearRaw) && r.daysToClearRaw < 999 ? r.daysToClearExcess : '999+',
    r.deadCapitalYears, RATING_LABELS[r.rating] ?? r.rating,
  ].join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'stock-turnover.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function StockTurnoverView({ databaseId }: { databaseId: string }) {
  const [filterType, setFilterType]         = useState<'brand' | 'supplier'>('supplier');
  const [filterValue, setFilterValue]       = useState('');
  const [filterQuery, setFilterQuery]       = useState('');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [salesWindowDays, setSalesWindowDays] = useState(90);
  const [targetDos, setTargetDos]           = useState(60);
  const [excludeNewItems, setExcludeNewItems] = useState(false);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [rows, setRows]                     = useState<TurnoverRow[]>([]);
  const [summary, setSummary]               = useState<TurnoverResponse['summary'] | null>(null);
  const [brandOptions, setBrandOptions]     = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; label: string }[]>([]);
  const [sortField, setSortField]           = useState<SortField>('deadCapitalYears');
  const [sortDir, setSortDir]               = useState<'desc' | 'asc'>('desc');
  const [ratingFilter, setRatingFilter]     = useState('');
  const [hideNoMovement, setHideNoMovement] = useState(false);
  const [hideZeroSoh, setHideZeroSoh]       = useState(true);

  // ── Sales drill-down modal ──
  const [detailRow, setDetailRow]       = useState<TurnoverRow | null>(null);
  const [detailData, setDetailData]     = useState<SalesDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError]   = useState('');

  const openSalesDetail = useCallback(async (row: TurnoverRow) => {
    setDetailRow(row);
    setDetailData(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const res = await fetch('/api/inventory/stock-turnover/sales-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, variantId: row.optionId }),
      });
      const data = await res.json() as SalesDetailResponse;
      if (!data.success) throw new Error(data.error ?? 'Failed to load sales detail.');
      setDetailData(data);
    } catch (e: any) {
      setDetailError(e.message ?? 'Failed to load sales detail.');
    }
    setDetailLoading(false);
  }, [databaseId]);

  const currentOptions = filterType === 'brand'
    ? brandOptions.map(v => ({ value: v, label: v }))
    : supplierOptions.map(o => ({ value: o.id, label: o.label }));

  const visibleFilterOptions = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    const opts = q
      ? currentOptions.filter(o => o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q))
      : currentOptions;
    return opts.slice(0, 25);
  }, [currentOptions, filterQuery]);

  const ratingCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, moderate: 0, low: 0, healthy: 0 };
    rows.forEach(r => { if (counts[r.rating] !== undefined) counts[r.rating]++; });
    return counts;
  }, [rows]);

  const displayedRows = useMemo(() => {
    let r = rows;
    if (hideNoMovement) r = r.filter(row => row.avgDailySales > 0);
    if (hideZeroSoh) r = r.filter(row => row.soh > 0);
    if (ratingFilter) r = r.filter(row => row.rating === ratingFilter);
    return [...r].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name')       return dir * a.name.localeCompare(b.name);
      if (sortField === 'capitalEff') {
        const av = a.capitalEff ?? -1;
        const bv = b.capitalEff ?? -1;
        return dir * (bv - av);
      }
      return dir * ((b[sortField] as number) - (a[sortField] as number));
    });
  }, [rows, hideNoMovement, hideZeroSoh, ratingFilter, sortField, sortDir]);

  const runAnalysis = useCallback(async () => {
    if (!databaseId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/inventory/stock-turnover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, filterType, filterValue, salesWindowDays, targetDos, excludeNewItems }),
      });
      const data = await res.json() as TurnoverResponse;
      if (!data.success) throw new Error(data.error ?? 'Analysis failed.');
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      if (data.options) {
        setBrandOptions(data.options.brands);
        setSupplierOptions(data.options.suppliers);
      }
    } catch (e: any) {
      setError(e.message ?? 'Analysis failed.');
    }
    setLoading(false);
  }, [databaseId, filterType, filterValue, salesWindowDays, targetDos, excludeNewItems]); // useCallback dependencies

  useEffect(() => {
    // Initial fetch to populate options with no filter
    if (!databaseId) return;
    fetch('/api/inventory/stock-turnover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseId, filterType: 'supplier', filterValue: '', salesWindowDays: 90, targetDos: 60, excludeNewItems: false }),
    })
      .then(res => res.json())
      .then((data: TurnoverResponse) => {
        if (data.success && data.options) {
          setBrandOptions(data.options.brands);
          setSupplierOptions(data.options.suppliers);
        }
      })
      .catch(() => {});
  }, [databaseId]);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-gray-300">
      {sortField === field ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
    </span>
  );

  const Th = ({ field, children, right }: { field: SortField; children: React.ReactNode; right?: boolean }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 border-b border-gray-200 ${right ? 'text-right' : 'text-left'}`}
    >
      {children}<SortIcon field={field} />
    </th>
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Stock Turnover Efficiency</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Identify products hogging capital — ranked by Clearance Priority (excess cash tied up × how long it stays stuck).
        </p>
      </div>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-end gap-3">

        {/* Filter type toggle */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Filter by</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {(['supplier', 'brand'] as const).map(t => (
              <button key={t} onClick={() => { setFilterType(t); setFilterValue(''); setFilterQuery(''); }}
                className={`px-3 py-1.5 font-medium capitalize transition-colors ${filterType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Filter value dropdown */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-500 mb-1">
            {filterType === 'brand' ? 'Brand' : 'Supplier'}
          </label>
          <button onClick={() => setFilterMenuOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white hover:bg-gray-50 min-w-[180px] justify-between">
            <span className="truncate max-w-[160px]">
              {filterValue
                ? (filterType === 'brand' ? filterValue : (supplierOptions.find(o => o.id === filterValue)?.label ?? filterValue))
                : `All ${filterType}s`}
            </span>
            <span className="text-gray-400">▾</span>
          </button>
          {filterMenuOpen && (
            <div className="absolute z-30 top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg">
              <div className="p-2 border-b border-gray-100">
                <input autoFocus value={filterQuery} onChange={e => setFilterQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                <button onClick={() => { setFilterValue(''); setFilterMenuOpen(false); setFilterQuery(''); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${!filterValue ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                  All {filterType}s
                </button>
                {visibleFilterOptions.map(o => (
                  <button key={o.value} onClick={() => { setFilterValue(o.value); setFilterMenuOpen(false); setFilterQuery(''); }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 truncate ${filterValue === o.value ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sales window */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Sales window</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {WINDOW_OPTIONS.map(w => (
              <button key={w} onClick={() => setSalesWindowDays(w)}
                className={`px-3 py-1.5 font-medium transition-colors ${salesWindowDays === w ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {w === 365 ? '12m' : `${w}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Target DOS */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Target DOS <span className="text-gray-400 font-normal italic">(fallback)</span></label>
          <input type="number" 
            value={targetDos} 
            onChange={e => setTargetDos(Math.max(1, parseInt(e.target.value) || 60))}
            className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" 
          />
        </div>

        {/* Exclude New Items */}
        <label className="flex items-center gap-2 text-sm font-medium text-gray-600 cursor-pointer mb-2">
          <input type="checkbox" checked={excludeNewItems} onChange={e => setExcludeNewItems(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
          Exclude New Items
        </label>

        <button onClick={runAnalysis} disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors self-end">
          {loading ? 'Analysing…' : 'Run Analysis'}
        </button>

        {rows.length > 0 && (
          <button onClick={() => downloadCsv(displayedRows)}
            className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors self-end">
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Capital Tied</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              ${summary.totalCapitalTied.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{summary.totalProducts} variants</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide">Excess Capital</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">
              ${summary.totalExcessCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-amber-500 mt-0.5">beyond order window</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Avg Days of Stock</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.avgDos}d</p>
            <p className="text-xs text-gray-400 mt-0.5">{summary.movingProducts} moving products</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Avg Turn Rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.avgTurnRate}×/yr</p>
            <p className="text-xs text-gray-400 mt-0.5">{summary.noMovementCount} with no movement</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Top Priority</p>
            <p className="text-sm font-bold text-red-700 mt-1 truncate">{summary.worstName || '—'}</p>
            <p className="text-xs text-red-400 mt-0.5">
              ${summary.worstExcessCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })} excess ·{' '}
              {isFinite(summary.worstDaysToClear) && summary.worstDaysToClear < 999 ? `${Math.round(summary.worstDaysToClear)}d to clear` : '999+d to clear'}
            </p>
          </div>
        </div>
      )}

      {/* ── Rating bar ── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {RATING_ORDER.map(g => (
            <button key={g} onClick={() => setRatingFilter(f => f === g ? '' : g)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors
                ${ratingFilter === g ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                ${RATING_COLORS[g] ?? 'bg-gray-100 text-gray-600'}`}>
              <span>{RATING_LABELS[g]}</span>
              <span className="ml-1 font-bold">{ratingCounts[g] ?? 0}</span>
            </button>
          ))}
          <div className="flex items-center gap-4 ml-auto">
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={hideZeroSoh} onChange={e => setHideZeroSoh(e.target.checked)}
                className="rounded border-gray-300" />
              Hide SOH = 0
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={hideNoMovement} onChange={e => setHideNoMovement(e.target.checked)}
                className="rounded border-gray-300" />
              Hide no-movement
            </label>
          </div>
        </div>
      )}

      {/* ── Results table ── */}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs border-collapse bg-white">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 w-8">#</th>
                <Th field="name">Product</Th>
                <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Brand</th>
                <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Supplier</th>
                <Th field="soh" right>SOH</Th>
                <Th field="salesQty" right>Sold</Th>
                <Th field="capitalTied" right>Capital Tied</Th>
                <Th field="dos" right>DOS</Th>
                <th className="px-3 py-2 font-semibold text-right border-b border-gray-200" title="Supplier Order Frequency (days), or Target DOS fallback">Order Freq</th>
                <Th field="excessStock" right>Excess Qty</Th>
                <Th field="excessCapital" right>Excess Cap.</Th>
                <Th field="daysToClearExcess" right>Clear In</Th>
                <Th field="deadCapitalYears" right>Deadweight</Th>
                <th className="text-center font-semibold px-3 py-2 border-b border-gray-200 w-20">Priority</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row, i) => (
                <tr key={row.optionId} className={`border-b border-gray-100 hover:bg-blue-50 ${row.rating === 'critical' ? 'bg-red-50/40' : row.rating === 'healthy' ? 'bg-emerald-50/30' : ''}`}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <div className="font-medium text-gray-800 truncate">{row.name}</div>
                    <div className="font-mono text-gray-400 text-[10px]">{row.code}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.brand || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">{row.supplierName}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openSalesDetail(row)}
                      title="Show all sales records for this variant"
                      className="text-blue-600 hover:text-blue-800 hover:underline font-medium tabular-nums cursor-pointer"
                    >
                      {row.soh.toLocaleString()}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.salesQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-800">
                    {row.capitalTied > 0 ? fmt$(row.capitalTied) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${row.dos >= 365 ? 'text-red-600 font-bold' : row.dos >= 90 ? 'text-orange-500' : 'text-gray-700'}`}>
                    {fmtDos(row.dos, row.dosRaw)}d
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500 text-[11px]">
                    {row.orderWindowDays}d
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.excessStock > 0 ? row.excessStock.toLocaleString(undefined, { maximumFractionDigits: 1 }) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${row.excessCapital > 50000 ? 'text-red-600' : row.excessCapital > 10000 ? 'text-orange-500' : 'text-gray-700'}`}>
                    {row.excessCapital > 0 ? fmt$(row.excessCapital) : <span className="font-normal text-gray-400">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${row.daysToClearExcess >= 365 ? 'text-red-600 font-bold' : row.daysToClearExcess >= 90 ? 'text-orange-500' : 'text-gray-700'}`}>
                    {row.excessStock > 0 || !isFinite(row.daysToClearRaw) ? `${fmtClear(row.daysToClearExcess, row.daysToClearRaw)}d` : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-700">
                    {row.deadCapitalYears > 0 ? fmt$(row.deadCapitalYears) : <span className="font-normal text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${RATING_COLORS[row.rating] ?? 'bg-gray-100 text-gray-500'}`}>
                      {RATING_LABELS[row.rating] ?? row.rating}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">📦</div>
          <p className="text-sm font-medium">Click <strong>Run Analysis</strong> to see stock turnover results.</p>
          <p className="text-xs mt-1">Products are ranked by Clearance Priority — excess cash tied up beyond the supplier's order window × how long it stays stuck.</p>
          <p className="text-[10px] mt-1 italic max-w-md mx-auto">The "Target DOS (fallback)" input above is only applied when the product's supplier lacks a defined Order Frequency.</p>
        </div>
      )}

      {/* ── Legend ── */}
      {rows.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Deadweight (Dead Capital-Years)</p>
            <p className="text-sm text-gray-700">Excess Capital × (Days to Clear ÷ 365). The dollar-years of cash stuck in stock beyond the supplier's order window. Sort by this to find the most important stock to clear for cashflow.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Excess Qty &amp; Clear In</p>
            <p className="text-sm text-gray-700">Excess Qty is stock beyond what sells within the supplier's Order Freq window. "Clear In" is how many extra days it takes to sell that excess through. A huge excess that clears in days is fine; a modest one taking months is not.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Priority Rating</p>
            <p className="text-sm text-gray-700">Critical → Healthy, weighing both how much cash is locked and how long it stays stuck. Cheap or fast-clearing excess is never flagged urgent; no-sales stock with SOH is always Critical.</p>
          </div>
        </div>
      )}

      {/* ── Sales drill-down modal ── */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
          onClick={() => setDetailRow(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8" onClick={e => e.stopPropagation()}>
            {/* header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-900 truncate">{detailRow.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-mono">{detailRow.code || '—'}</span>
                  {detailData?.variant?.cin7OptionId != null && <span> · Cin7 opt {detailData.variant.cin7OptionId}</span>}
                  {' · '}All sales records across channels
                </p>
              </div>
              <button onClick={() => setDetailRow(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-3">×</button>
            </div>

            <div className="px-5 py-4">
              {detailLoading && <div className="text-center py-10 text-gray-400 text-sm">Loading sales records…</div>}
              {detailError && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{detailError}</div>}

              {detailData && !detailLoading && (
                <>
                  {/* reconciliation summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {([
                      ['POS', detailData.totals?.pos ?? 0, 'text-purple-700 bg-purple-50 border-purple-100'],
                      ['Wholesale', detailData.totals?.wholesale ?? 0, 'text-blue-700 bg-blue-50 border-blue-100'],
                      ['Online', detailData.totals?.online ?? 0, 'text-teal-700 bg-teal-50 border-teal-100'],
                      ['Cin7 history', detailData.totals?.history ?? 0, 'text-gray-600 bg-gray-50 border-gray-200'],
                    ] as const).map(([label, val, cls]) => (
                      <div key={label} className={`rounded-lg border px-3 py-2 ${cls}`}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
                        <p className="text-lg font-bold tabular-nums">{val.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-600 mb-3">
                    <span><strong className="text-emerald-700">{(detailData.totals?.counted ?? 0).toLocaleString()}</strong> counted (last 365d, all channels)</span>
                    {(detailData.totals?.uncounted ?? 0) > 0 && (
                      <span><strong className="text-orange-600">{(detailData.totals?.uncounted ?? 0).toLocaleString()}</strong> not counted (excluded rows)</span>
                    )}
                    {detailData.cache && (
                      <span className="text-gray-400">Cache 12m: <strong className="text-gray-600">{Number(detailData.cache.sales_qty_12m).toLocaleString()}</strong></span>
                    )}
                  </div>

                  {/* rows table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Channel</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Date</th>
                          <th className="text-right font-semibold px-3 py-2 border-b border-gray-200">Qty</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Status</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Reference</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Counted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detailData.rows ?? []).length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No sales records found for this variant.</td></tr>
                        )}
                        {(detailData.rows ?? []).map((r, i) => (
                          <tr key={i} className={`border-b border-gray-100 ${!r.counted && r.channel !== 'history' ? 'bg-orange-50/40' : ''}`}>
                            <td className="px-3 py-1.5">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${CHANNEL_COLORS[r.channel]}`}>
                                {CHANNEL_LABELS[r.channel]}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.date ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-800">{r.qty.toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-gray-500">{r.status}{r.linkedBy === 'sku' && <span className="text-amber-600"> · via SKU</span>}</td>
                            <td className="px-3 py-1.5 text-gray-500 max-w-[160px] truncate">{r.reference}</td>
                            <td className="px-3 py-1.5">
                              {r.channel === 'history'
                                ? <span className="text-gray-400" title={r.note}>ref only</span>
                                : r.counted
                                  ? <span className="text-emerald-600 font-semibold" title={r.note || 'counted'}>✓</span>
                                  : <span className="text-orange-500" title={r.note}>✕ {r.note.replace(/^excluded: /, '')}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 italic">
                    Counted rows feed the sales cache (POS completed sales + non-draft/cancelled orders, last 365 days).
                    "Cin7 history" is shown for reference only and is not double-counted. Rows linked "via SKU" had a missing variant link and are recovered by SKU match.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
