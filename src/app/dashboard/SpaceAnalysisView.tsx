'use client';

import { useEffect, useMemo, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpaceRow {
  productId: string;
  optionId: string;
  code: string;
  name: string;
  brand: string;
  supplierId: string;
  supplierName: string;
  volumeRating: number;
  hasVolume: boolean;
  salesQty: number;
  avgDailySales: number;
  totalSOH: number;
  cost: number;
  sei: number;
  grade: string;
  stars: number;
  label: string;
}

interface AnalysisResponse {
  success: boolean;
  error?: string;
  options?: { brands: string[]; suppliers: { id: string; label: string }[] };
  rows?: SpaceRow[];
  summary?: { totalRows: number; rankedRows: number; unrankedRows: number; avgSei: number };
}

interface EstimateItem {
  rowIndex: number;
  optionId: string;
  code: string;
  name: string;
  brand: string;
  estimatedVolume: number | null;
}

interface EstimateResponse {
  success: boolean;
  error?: string;
  estimates?: EstimateItem[];
  totalUnset?: number;
  message?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-green-100 text-green-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-red-100 text-red-800',
  '?': 'bg-gray-100 text-gray-500',
};

function Stars({ count }: { count: number }) {
  return (
    <span className="text-yellow-400 text-xs">
      {'★'.repeat(count)}{'☆'.repeat(5 - count)}
    </span>
  );
}

const DEFAULT_CALIBRATION: Record<string, string> = {
  '1': '',
  '2': '',
  '3': '',
  '4': '',
  '5': '',
  '6': '',
  '7': '',
  '8': '',
  '9': '',
  '10': '',
};

const WINDOW_OPTIONS = [7, 90, 180, 365] as const;

function round(v: number, p = 4): number {
  return Math.round(v * 10 ** p) / 10 ** p;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SpaceAnalysisView({ databaseId }: { databaseId: string }) {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'setup' | 'analysis'>('setup');

  // ── Volume calibration ────────────────────────────────────────────────────
  const [calibration, setCalibration] = useState<Record<string, string>>(DEFAULT_CALIBRATION);

  // ── Calibration load/save state ───────────────────────────────────────────
  const [calibrationSaving, setCalibrationSaving] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState('');
  const [calibrationError, setCalibrationError] = useState('');

  // ── AI estimation state ───────────────────────────────────────────────────
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [estimateMessage, setEstimateMessage] = useState('');
  const [pendingEstimates, setPendingEstimates] = useState<EstimateItem[]>([]);
  const [totalUnset, setTotalUnset] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // ── Analysis state ────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<'brand' | 'supplier'>('supplier');
  const [filterValue, setFilterValue] = useState('');
  const [salesWindowDays, setSalesWindowDays] = useState<number>(90);
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [summary, setSummary] = useState<AnalysisResponse['summary'] | null>(null);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; label: string }[]>([]);
  const [showUnranked, setShowUnranked] = useState(false);
  const [sortField, setSortField] = useState<'sei' | 'salesQty' | 'volumeRating' | 'name'>('sei');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [gradeFilter, setGradeFilter] = useState<string>('');

  // ── Load calibration on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/inventory/volume-calibration?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.calibration && Object.keys(data.calibration).length > 0) {
          setCalibration(prev => ({ ...prev, ...data.calibration }));
        }
      })
      .catch(() => { /* ignore — use defaults */ });
  }, [databaseId]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentOptions = filterType === 'brand'
    ? brandOptions.map(v => ({ value: v, label: v }))
    : supplierOptions.map(o => ({ value: o.id, label: o.label }));

  const displayedRows = useMemo(() => {
    let r = showUnranked ? rows : rows.filter(row => row.hasVolume);
    if (gradeFilter) r = r.filter(row => row.grade === gradeFilter);
    return [...r].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name') return dir * a.name.localeCompare(b.name);
      return dir * ((b[sortField] as number) - (a[sortField] as number));
    });
  }, [rows, showUnranked, gradeFilter, sortField, sortDir]);

  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    rows.filter(r => r.hasVolume).forEach(r => { if (counts[r.grade] !== undefined) counts[r.grade]++; });
    return counts;
  }, [rows]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    if (!databaseId) return;
    setLoading(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/inventory/space-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, filterType, filterValue, salesWindowDays }),
      });
      const data = await res.json() as AnalysisResponse;
      if (!data.success) throw new Error(data.error ?? 'Analysis failed.');
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setBrandOptions(data.options?.brands ?? []);
      setSupplierOptions(data.options?.suppliers ?? []);
    } catch (e: any) {
      setAnalysisError(e.message ?? 'Analysis failed.');
    }
    setLoading(false);
  };

  const saveCalibration = async () => {
    if (!databaseId) return;
    setCalibrationSaving(true);
    setCalibrationMessage('');
    setCalibrationError('');
    try {
      const res = await fetch('/api/inventory/volume-calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, calibration }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Save failed.');
      setCalibrationMessage('Calibration saved to your inventory sheet.');
    } catch (e: any) {
      setCalibrationError(e.message ?? 'Save failed.');
    }
    setCalibrationSaving(false);
  };

  const runEstimateAll = async () => {
    if (!databaseId) return;
    setEstimating(true);
    setEstimateError('');
    setEstimateMessage('');
    setSaveMessage('');
    try {
      const res = await fetch('/api/ai/estimate-volumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, calibration }),
      });
      const data = await res.json() as EstimateResponse;
      if (!data.success) throw new Error(data.error ?? 'Estimation failed.');
      setPendingEstimates(data.estimates ?? []);
      setTotalUnset(data.totalUnset ?? null);
      if ((data.estimates ?? []).length === 0) {
        setEstimateMessage(data.message ?? 'All products already have a volume — nothing to estimate.');
      } else {
        const estimated = (data.estimates ?? []).filter(e => e.estimatedVolume !== null).length;
        const total = data.estimates!.length;
        const blanks = total - estimated;
        setEstimateMessage(
          `AI estimated ${estimated} of ${data.totalUnset} products.` +
          (blanks > 0 ? ` ${blanks} could not be estimated (use "Fill blanks with 5" for defaults).` : '') +
          ` Review and adjust below, then click Save.`
        );
      }
    } catch (e: any) {
      setEstimateError(e.message ?? 'Estimation failed.');
    }
    setEstimating(false);
  };

  const updatePendingVolume = (rowIndex: number, volume: number) => {
    setPendingEstimates(prev => prev.map(e =>
      e.rowIndex === rowIndex ? { ...e, estimatedVolume: Math.min(10, Math.max(1, Math.round(volume))) } : e
    ));
  };

  const saveEstimates = async () => {
    if (!databaseId || pendingEstimates.length === 0) return;
    setSaving(true);
    setSaveMessage('');
    setEstimateError('');
    try {
      const updates = pendingEstimates
        .filter(e => e.estimatedVolume !== null)
        .map(e => ({ optionId: e.optionId, volume: e.estimatedVolume! }));
      const res = await fetch('/api/inventory/save-volumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, updates }),
      });
      const data = await res.json();
      if (!data.success && data.errors?.length > 0) throw new Error(data.errors[0]);
      setSaveMessage(data.message ?? `Saved ${updates.length} volumes.`);
      setPendingEstimates([]);
    } catch (e: any) {
      setEstimateError(e.message ?? 'Save failed.');
    }
    setSaving(false);
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-xl">📐</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Space Efficiency Analysis</h2>
            <p className="text-xs text-gray-500">Rate how well products earn their shelf space. Uses Sales per Unit of Space — a standard retail floor productivity metric.</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit mb-6">
          {(['setup', 'analysis'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'setup' ? '📏 Volume Setup' : '📊 Space Analysis'}
            </button>
          ))}
        </div>

        {/* ── Tab: Volume Setup ─────────────────────────────────────────── */}
        {tab === 'setup' && (
          <div className="space-y-6">
            {/* Calibration */}
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-1">Volume Scale Calibration</h3>
              <p className="text-xs text-gray-500 mb-4">
                Describe what each level looks like for your product range (e.g. Level 1: Small earrings, Level 10: Large backpack).
                This context is passed to the AI to make estimates consistent with your store.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(level => (
                  <label key={level} className="block">
                    <span className="block text-xs font-semibold text-gray-600 mb-1">Level {level}</span>
                    <input
                      type="text"
                      value={calibration[String(level)] ?? ''}
                      onChange={e => setCalibration(prev => ({ ...prev, [String(level)]: e.target.value }))}
                      placeholder={level === 1 ? 'e.g. Small earrings' : level === 10 ? 'e.g. Large backpack' : '…'}
                      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={saveCalibration}
                  disabled={calibrationSaving || !databaseId}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {calibrationSaving ? 'Saving…' : 'Save Calibration'}
                </button>
                {calibrationMessage && <span className="text-sm text-emerald-700">✅ {calibrationMessage}</span>}
                {calibrationError && <span className="text-sm text-red-600">❌ {calibrationError}</span>}
              </div>
            </div>

            {/* AI estimation */}
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-bold text-gray-700 mb-1">AI Volume Estimation</h3>
              <p className="text-xs text-gray-500 mb-4">
                The AI will read product names from your Products sheet and estimate a volume rating for up to 10 products at a time.
                Products that already have a volume set are skipped.
                {totalUnset !== null && (
                  <> Currently <span className="font-semibold text-orange-600">{totalUnset}</span> product{totalUnset !== 1 ? 's' : ''} without a volume rating.</>
                )}
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <button
                  onClick={runEstimateAll}
                  disabled={estimating || !databaseId}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {estimating ? 'Estimating all products…' : 'Estimate All Products'}
                </button>
              </div>

              {estimateError && <p className="text-sm text-red-600 mb-3">❌ {estimateError}</p>}
              {estimateMessage && <p className="text-sm text-emerald-700 mb-3">✅ {estimateMessage}</p>}
              {saveMessage && <p className="text-sm text-blue-700 mb-3">💾 {saveMessage}</p>}

              {/* Pending estimates table */}
              {pendingEstimates.length > 0 && (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600">
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Code</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Product</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-200">Brand</th>
                          <th className="text-center font-semibold px-3 py-2 border-b border-gray-200 w-28">Volume (1–10)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingEstimates.map(e => (
                          <tr key={e.rowIndex} className="border-b border-gray-100 hover:bg-purple-50">
                            <td className="px-3 py-2 font-mono text-gray-700">{e.code || '—'}</td>
                            <td className="px-3 py-2 text-gray-800 max-w-xs truncate">{e.name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{e.brand || '—'}</td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={e.estimatedVolume ?? ''}
                                onChange={ev => updatePendingVolume(e.rowIndex, Number(ev.target.value))}
                                className="w-16 px-2 py-1 text-center border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={saveEstimates}
                      disabled={saving}
                      className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? 'Saving…' : 'Save Volumes to Products Sheet'}
                    </button>
                    <button
                      onClick={() => setPendingEstimates(prev => prev.map(e => e.estimatedVolume !== null ? e : { ...e, estimatedVolume: 5 }))}
                      className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Fill blanks with 5
                    </button>
                    <button
                      onClick={() => { setPendingEstimates([]); setEstimateMessage(''); }}
                      className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Info panel */}
            <div className="border-t border-gray-100 pt-5">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Volume Scale</p>
                  <p className="text-sm text-gray-700">1 = smallest possible display footprint. 10 = largest. A level 10 product takes ~5× the space of a level 2.</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Products Sheet</p>
                  <p className="text-sm text-gray-700">Volume ratings are stored in the <strong>volume</strong> column of your Products sheet. You can edit them directly in Google Sheets too.</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Next Step</p>
                  <p className="text-sm text-gray-700">Once volumes are set, switch to the <strong>Space Analysis</strong> tab to see which products are earning their shelf space.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Space Analysis ───────────────────────────────────────── */}
        {tab === 'analysis' && (
          <div className="space-y-5">
            {/* Filter controls */}
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Group By</span>
                <select
                  value={filterType}
                  onChange={e => { setFilterType(e.target.value as 'brand' | 'supplier'); setFilterValue(''); }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  <option value="supplier">Supplier</option>
                  <option value="brand">Brand</option>
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  {filterType === 'brand' ? 'Brand' : 'Supplier'} (optional)
                </span>
                <select
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">All {filterType === 'brand' ? 'brands' : 'suppliers'}</option>
                  {currentOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Sales Window</span>
                <select
                  value={salesWindowDays}
                  onChange={e => setSalesWindowDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  {WINDOW_OPTIONS.map(d => (
                    <option key={d} value={d}>{d} days</option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  onClick={runAnalysis}
                  disabled={loading || !databaseId}
                  className="w-full px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Analysing…' : 'Run Analysis'}
                </button>
              </div>
            </div>

            {analysisError && <p className="text-sm text-red-600">❌ {analysisError}</p>}

            {/* Summary stats */}
            {summary && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Products</p>
                    <p className="text-lg font-bold text-gray-800">{summary.totalRows}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Ranked</p>
                    <p className="text-lg font-bold text-gray-800">{summary.rankedRows}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">No Volume Set</p>
                    <p className={`text-lg font-bold ${summary.unrankedRows > 0 ? 'text-orange-600' : 'text-gray-800'}`}>{summary.unrankedRows}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Avg SEI</p>
                    <p className="text-lg font-bold text-gray-800">{summary.avgSei.toFixed(4)}</p>
                  </div>
                </div>

                {/* Grade breakdown */}
                {summary.rankedRows > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setGradeFilter('')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${gradeFilter === '' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      All
                    </button>
                    {(['A', 'B', 'C', 'D', 'E'] as const).map(g => (
                      <button
                        key={g}
                        onClick={() => setGradeFilter(gradeFilter === g ? '' : g)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${gradeFilter === g ? 'ring-2 ring-offset-1 ring-gray-400' : ''} ${GRADE_COLORS[g]}`}
                      >
                        {g} — {['Excellent', 'Good', 'Average', 'Below Average', 'Poor'][['A','B','C','D','E'].indexOf(g)]} ({gradeCounts[g]})
                      </button>
                    ))}
                  </div>
                )}

                {summary.unrankedRows > 0 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="showUnranked"
                      checked={showUnranked}
                      onChange={e => setShowUnranked(e.target.checked)}
                      className="w-4 h-4 accent-purple-600"
                    />
                    <label htmlFor="showUnranked" className="text-sm text-gray-600 cursor-pointer">
                      Show {summary.unrankedRows} unranked product{summary.unrankedRows !== 1 ? 's' : ''} (no volume set)
                    </label>
                  </div>
                )}
              </>
            )}

            {/* Results table */}
            {displayedRows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Grade</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Stars</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Code</th>
                      <th
                        className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleSort('name')}
                      >
                        Product {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Brand</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Supplier</th>
                      <th
                        className="text-right font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleSort('volumeRating')}
                      >
                        Volume {sortField === 'volumeRating' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th
                        className="text-right font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleSort('salesQty')}
                      >
                        Sales Qty {sortField === 'salesQty' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="text-right font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">Avg/Day</th>
                      <th className="text-right font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">SOH</th>
                      <th
                        className="text-right font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleSort('sei')}
                      >
                        SEI {sortField === 'sei' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((row, i) => (
                      <tr key={`${row.optionId}-${i}`} className="border-b border-gray-100 hover:bg-purple-50 transition-colors">
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded font-bold text-xs ${GRADE_COLORS[row.grade]}`}>
                            {row.grade}
                          </span>
                        </td>
                        <td className="px-3 py-2"><Stars count={row.stars} /></td>
                        <td className="px-3 py-2 font-mono text-gray-700">{row.code}</td>
                        <td className="px-3 py-2 text-gray-800 font-medium max-w-xs truncate">{row.name}</td>
                        <td className="px-3 py-2 text-gray-600">{row.brand}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">{row.supplierName}</td>
                        <td className="px-3 py-2 text-right">
                          {row.hasVolume ? (
                            <span className="inline-flex items-center gap-0.5">
                              <span className="font-semibold">{row.volumeRating}</span>
                              <span className="text-gray-400">/10</span>
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{row.salesQty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{row.avgDailySales.toFixed(3)}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{row.totalSOH.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800">
                          {row.hasVolume ? row.sei.toFixed(4) : <span className="text-gray-400 italic font-normal">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && displayedRows.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-6">No rows match the current filter.</p>
            )}

            {rows.length === 0 && !loading && (
              <div className="text-center py-10 text-gray-400">
                <div className="text-4xl mb-3">📐</div>
                <p className="text-sm">Click <strong>Run Analysis</strong> to see space efficiency results.</p>
                <p className="text-xs mt-1">Make sure products have a volume rating set — use the Volume Setup tab first.</p>
              </div>
            )}

            {/* Metric explanation */}
            {rows.length > 0 && (
              <div className="grid md:grid-cols-3 gap-3 mt-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Space Efficiency Index (SEI)</p>
                  <p className="text-sm text-gray-700">SEI = Average daily sales ÷ Volume rating. Higher means the product sells more per unit of display space it occupies.</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Grading</p>
                  <p className="text-sm text-gray-700">Products are ranked by SEI within the filtered set. Grades are assigned by percentile: top 20% = A, bottom 20% = E.</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Action</p>
                  <p className="text-sm text-gray-700">Grade E products may be candidates for reduced display space or replacement. Grade A products may deserve more prominent placement.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
