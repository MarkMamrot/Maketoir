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
  excessCapital: number;
  targetDosUsed: number;
  grade:         string;
  stars:         number;
  label:         string;
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
    totalSales:       number;
    avgDos:           number;
    avgTurnRate:      number;
    worstName:        string;
    worstExcessCapital: number;
  };
}

type SortField = 'excessCapital' | 'capitalTied' | 'dos' | 'turnRate' | 'capitalEff' | 'soh' | 'salesQty' | 'name';

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-green-100 text-green-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-red-100 text-red-800',
  '?': 'bg-gray-100 text-gray-500',
};

const GRADE_LABELS: Record<string, string> = {
  A: 'Fast Mover', B: 'Good', C: 'Average', D: 'Slow', E: 'Dead Stock', '?': 'No Movement',
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

const WINDOW_OPTIONS = [7, 90, 180, 365] as const;

function downloadCsv(rows: TurnoverRow[]) {
  const headers = ['Code','Name','Brand','Supplier','SOH','Cost','Capital Tied','Sales Qty','Avg Daily Sales','DOS','Turn Rate','Capital Efficiency','Target DOS Used','Excess Capital','Grade'];
  const lines = [headers.join(','), ...rows.map(r => [
    r.code, `"${r.name.replace(/"/g, '""')}"`, r.brand, `"${r.supplierName.replace(/"/g, '""')}"`,
    r.soh, r.cost, r.capitalTied, r.salesQty, r.avgDailySales,
    isFinite(r.dosRaw) && r.dosRaw < 999 ? r.dos : '999+',
    r.turnRate, r.capitalEff ?? '', r.targetDosUsed, r.excessCapital, r.grade,
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
  const [sortField, setSortField]           = useState<SortField>('excessCapital');
  const [sortDir, setSortDir]               = useState<'desc' | 'asc'>('desc');
  const [gradeFilter, setGradeFilter]       = useState('');
  const [hideNoMovement, setHideNoMovement] = useState(false);
  const [hideZeroSoh, setHideZeroSoh]       = useState(true);

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

  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, '?': 0 };
    rows.forEach(r => { if (counts[r.grade] !== undefined) counts[r.grade]++; });
    return counts;
  }, [rows]);

  const displayedRows = useMemo(() => {
    let r = rows;
    if (hideNoMovement) r = r.filter(row => row.avgDailySales > 0);
    if (hideZeroSoh) r = r.filter(row => row.soh > 0);
    if (gradeFilter) r = r.filter(row => row.grade === gradeFilter);
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
  }, [rows, hideNoMovement, gradeFilter, sortField, sortDir]);

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
          Identify products hogging capital — ranked by Excess Capital (cost of stock beyond Target DOS).
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
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Total Sales</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {summary.totalSales.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">qty in period</p>
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
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Worst Offender</p>
            <p className="text-sm font-bold text-red-700 mt-1 truncate">{summary.worstName || '—'}</p>
            <p className="text-xs text-red-400 mt-0.5">
              Excess Cap: ${summary.worstExcessCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      )}

      {/* ── Grade bar ── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {['A','B','C','D','E','?'].map(g => (
            <button key={g} onClick={() => setGradeFilter(f => f === g ? '' : g)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors
                ${gradeFilter === g ? 'ring-2 ring-offset-1 ring-blue-400' : ''}
                ${GRADE_COLORS[g] ?? 'bg-gray-100 text-gray-600'}`}>
              <span>{g}</span>
              <span className="opacity-70">{GRADE_LABELS[g]}</span>
              <span className="ml-1 font-bold">{gradeCounts[g] ?? 0}</span>
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
                <Th field="turnRate" right>Turn/yr</Th>
                <Th field="capitalEff" right>Cap. Eff.</Th>
                <th className="px-3 py-2 font-semibold text-right border-b border-gray-200" title="Values mapped from Supplier Order Frequency">Target DOS</th>
                <Th field="excessCapital" right>Excess Cap.</Th>
                <th className="text-center font-semibold px-3 py-2 border-b border-gray-200 w-16">Grade</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row, i) => (
                <tr key={row.optionId} className={`border-b border-gray-100 hover:bg-blue-50 ${row.grade === 'E' ? 'bg-red-50/40' : row.grade === 'A' ? 'bg-emerald-50/30' : ''}`}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <div className="font-medium text-gray-800 truncate">{row.name}</div>
                    <div className="font-mono text-gray-400 text-[10px]">{row.code}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.brand || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">{row.supplierName}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.soh.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.salesQty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-800">
                    {row.capitalTied > 0 ? fmt$(row.capitalTied) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${row.dos >= 365 ? 'text-red-600 font-bold' : row.dos >= 90 ? 'text-orange-500' : 'text-gray-700'}`}>
                    {fmtDos(row.dos, row.dosRaw)}d
                  </td>
                  <td className={`px-3 py-2 text-right ${row.turnRate >= 4 ? 'text-emerald-600 font-semibold' : row.turnRate > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                    {row.turnRate > 0 ? `${row.turnRate}×` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 font-mono text-[11px]">
                    {row.capitalEff != null ? row.capitalEff.toFixed(3) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500 text-[11px]">
                    {row.targetDosUsed}d
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${row.excessCapital > 50000 ? 'text-red-600' : row.excessCapital > 10000 ? 'text-orange-500' : 'text-gray-700'}`}>
                    {row.excessCapital > 0 ? fmt$(row.excessCapital) : <span className="font-normal text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${GRADE_COLORS[row.grade] ?? 'bg-gray-100 text-gray-500'}`}>
                      {row.grade}
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
          <p className="text-xs mt-1">Products are ranked by Excess Capital — stock beyond Target DOS × cost.</p>
          <p className="text-[10px] mt-1 italic max-w-md mx-auto">The "Target DOS (fallback)" input above is only applied when the product's supplier lacks a defined Order Frequency.</p>
        </div>
      )}

      {/* ── Legend ── */}
      {rows.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Deadweight Score</p>
            <p className="text-sm text-gray-700">Capital Tied ($) × Days of Stock. The higher the score, the more this product is locking up your cash over time. Sort by this column to find your worst offenders.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Days of Stock (DOS)</p>
            <p className="text-sm text-gray-700">SOH ÷ avg daily sales. Red = 365+ days (over a year of stock). Green grades mean the product turns fast relative to peers.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Capital Efficiency</p>
            <p className="text-sm text-gray-700">(Daily sales × price) ÷ capital tied. How much revenue each dollar of tied capital generates daily. Higher = better use of capital.</p>
          </div>
        </div>
      )}
    </div>
  );
}
