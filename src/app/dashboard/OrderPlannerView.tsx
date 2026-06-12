'use client';

import { useEffect, useMemo, useState } from 'react';

type FilterType = 'brand' | 'supplier';

interface PlannerOptionSupplier {
  id: string;
  label: string;
}

interface BranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface PlannerRow {
  productId: string;
  optionId: string;
  code: string;
  name: string;
  brand: string;
  supplierId: string;
  supplierName: string;
  createdDate: string;
  daysInStock: number;
  effectiveSalesDays: number;
  totalSOH: number;
  totalAvailable: number;
  totalIncoming: number;
  salesQty: number;
  avgDailySales: number;
  leadTimeDays: number;
  coverageDays: number;
  suggestedQty: number;
  packSize: number;
  reorderQty: number;
  cost: number;
  estimatedLineValue: number;
}

interface PlannerResponse {
  success: boolean;
  error?: string;
  options?: {
    brands: string[];
    suppliers: PlannerOptionSupplier[];
  };
  supplierLeadTimes?: Record<string, number>;
  selectedSalesBranches?: string[];
  branches?: BranchOption[];
  rows?: PlannerRow[];
  summary?: {
    totalRows: number;
    totalUnits: number;
    totalValue: number;
  };
  spreadsheetUrl?: string;
  sheetName?: string;
  draft?: {
    spreadsheetUrl: string;
    sheetName: string;
  };
  purchaseOrderId?: string | number | null;
  reference?: string | null;
}

const WINDOW_OPTIONS = [7, 90, 180, 365] as const;

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function rowKey(row: PlannerRow): string {
  return row.optionId || `${row.productId}-${row.code}-${row.name}`;
}

export function OrderPlannerView({ databaseId }: { databaseId: string }) {
  const [filterType, setFilterType] = useState<FilterType>('supplier');
  const [filterValue, setFilterValue] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [salesWindowDays, setSalesWindowDays] = useState<number>(90);
  const [orderFrequencyDays, setOrderFrequencyDays] = useState<number>(30);
  const [branchId, setBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftSheetName, setDraftSheetName] = useState('');
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<PlannerOptionSupplier[]>([]);
  const [leadTimeOverride, setLeadTimeOverride] = useState<number>(0);
  const [salesScope, setSalesScope] = useState<'all' | 'selected'>('all');
  const [salesBranchIds, setSalesBranchIds] = useState<string[]>([]);
  const [rows, setRows] = useState<PlannerRow[]>([]);
  const [showZeroRows, setShowZeroRows] = useState(false);

  const activeBranches = useMemo(
    () => branches.filter(branch => branch.isActive),
    [branches],
  );

  const currentFilterOptions = filterType === 'brand'
    ? brandOptions.map(value => ({ value, label: value }))
    : supplierOptions.map(option => ({ value: option.id, label: option.label }));

  const visibleFilterOptions = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    const matches = query
      ? currentFilterOptions
          .map(option => {
            const label = String(option.label || '').toLowerCase();
            const value = String(option.value || '').toLowerCase();
            const labelStarts = label.startsWith(query);
            const valueStarts = value.startsWith(query);
            const labelIncludes = label.includes(query);
            const valueIncludes = value.includes(query);
            const rank = labelStarts || valueStarts ? 0 : labelIncludes || valueIncludes ? 1 : 2;
            return { option, rank };
          })
          .filter(entry => entry.rank < 2)
          .sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.option.label.localeCompare(b.option.label, undefined, { sensitivity: 'base' });
          })
          .map(entry => entry.option)
      : [...currentFilterOptions].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return matches.slice(0, 20);
  }, [currentFilterOptions, filterQuery]);

  const filteredRows = useMemo(
    () => showZeroRows ? rows : rows.filter(row => row.reorderQty > 0 || row.suggestedQty > 0),
    [rows, showZeroRows],
  );

  const summary = useMemo(() => ({
    totalLines: filteredRows.length,
    totalUnits: filteredRows.reduce((sum, row) => sum + (Number(row.reorderQty) || 0), 0),
    totalValue: round(filteredRows.reduce((sum, row) => sum + (Number(row.reorderQty) || 0) * (Number(row.cost) || 0), 0)),
    supplierCount: new Set(filteredRows.filter(row => row.reorderQty > 0).map(row => row.supplierId).filter(Boolean)).size,
  }), [filteredRows]);

  const selectedBranch = activeBranches.find(branch => branch.id === branchId) ?? branches.find(branch => branch.id === branchId) ?? null;

  const loadOptions = async () => {
    if (!databaseId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/order-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          databaseId,
          filterType,
          filterValue: '',
          salesWindowDays,
          orderFrequencyDays,
        }),
      });
      const data = await res.json() as PlannerResponse;
      if (!data.success) throw new Error(data.error ?? 'Failed to load order planner options.');
      setBrandOptions(data.options?.brands ?? []);
      setSupplierOptions(data.options?.suppliers ?? []);
      setBranches(data.branches ?? []);
      // lead time override is user-controlled; don't reset from sheet
      if (salesBranchIds.length === 0 && (data.branches ?? []).length > 0) {
        setSalesBranchIds((data.branches ?? []).filter(branch => branch.isActive).map(branch => branch.id));
      }
      if (!branchId) {
        const firstActive = (data.branches ?? []).find(branch => branch.isActive);
        if (firstActive) setBranchId(firstActive.id);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load order planner options.');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  useEffect(() => {
    if (filterValue && !currentFilterOptions.some(option => option.value === filterValue)) {
      setFilterValue('');
    }
  }, [currentFilterOptions, filterValue]);

  useEffect(() => {
    if (!filterValue) return;
    const selected = currentFilterOptions.find(option => option.value === filterValue);
    if (selected && selected.label !== filterQuery) {
      setFilterQuery(selected.label);
    }
  }, [currentFilterOptions, filterValue]);

  const selectFilterOption = (value: string) => {
    const selected = currentFilterOptions.find(option => option.value === value);
    setFilterValue(value);
    setFilterQuery(selected?.label ?? '');
    setFilterMenuOpen(false);
  };

  const generatePlan = async () => {
    if (!databaseId) { setError('No business selected.'); return; }
    if (!filterValue) { setError(`Select a ${filterType} first.`); return; }
    setLoading(true);
    setError('');
    setMessage('');
    setDraftUrl('');
    setDraftSheetName('');
    try {
      const res = await fetch('/api/inventory/order-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          databaseId,
          filterType,
          filterValue,
          salesWindowDays,
          orderFrequencyDays,
          supplierLeadTimeOverrides: leadTimeOverride > 0 ? { __global: leadTimeOverride } : {},
          salesBranchIds: salesScope === 'selected' ? salesBranchIds : [],
        }),
      });
      const data = await res.json() as PlannerResponse;
      if (!data.success) throw new Error(data.error ?? 'Failed to build order plan.');
      setBrandOptions(data.options?.brands ?? []);
      setSupplierOptions(data.options?.suppliers ?? []);
      setBranches(data.branches ?? []);
      const mappedRows = (data.rows ?? []).map(row => ({
        ...row,
        reorderQty: Number(row.reorderQty) || 0,
        cost: Number(row.cost) || 0,
        estimatedLineValue: round((Number(row.reorderQty) || 0) * (Number(row.cost) || 0)),
      }));
      setRows(mappedRows);
      const nonZeroCount = mappedRows.filter(r => r.reorderQty > 0 || r.suggestedQty > 0).length;
      const totalRows = data.summary?.totalRows ?? 0;
      if (nonZeroCount === 0 && totalRows > 0) {
        setMessage(`Built ${totalRows} product${totalRows === 1 ? '' : 's'} for this ${filterType} — all have zero suggested reorder quantity. Enable "Show zero-qty rows" to review them.`);
      } else {
        setMessage(`Built ${totalRows} product${totalRows === 1 ? '' : 's'} — ${nonZeroCount} have a non-zero reorder quantity.`);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to build order plan.');
      setRows([]);
    }
    setLoading(false);
  };

  const updateRow = (targetKey: string, field: 'reorderQty' | 'cost', nextValue: number) => {
    setRows(prev => prev.map(row => {
      if (rowKey(row) !== targetKey) return row;
      let value = nextValue;
      if (field === 'reorderQty' && row.packSize > 0 && value > 0) {
        value = Math.max(row.packSize, Math.round(value / row.packSize) * row.packSize);
      }
      const updated = { ...row, [field]: value } as PlannerRow;
      updated.estimatedLineValue = round((Number(updated.reorderQty) || 0) * (Number(updated.cost) || 0));
      return updated;
    }));
  };

  const persist = async (action: 'save-draft' | 'push-cin7') => {
    if (!databaseId) { setError('No business selected.'); return; }
    if (rows.length === 0) { setError('Generate an order plan first.'); return; }
    if (action === 'push-cin7' && !branchId) { setError('Pick a destination branch before pushing to Cin7.'); return; }

    setError('');
    setMessage('');
    if (action === 'save-draft') setSaving(true);
    if (action === 'push-cin7') setPushing(true);

    try {
      const res = await fetch('/api/inventory/order-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          databaseId,
          filterType,
          filterValue,
          salesWindowDays,
          orderFrequencyDays,
          branchId,
          branchName: selectedBranch?.name ?? '',
          supplierLeadTimeOverrides: leadTimeOverride > 0 ? { __global: leadTimeOverride } : {},
          salesBranchIds: salesScope === 'selected' ? salesBranchIds : [],
          rows,
        }),
      });
      const data = await res.json() as PlannerResponse;
      if (!data.success) throw new Error(data.error ?? 'Order action failed.');
      const url = data.spreadsheetUrl ?? data.draft?.spreadsheetUrl ?? '';
      const sheetName = data.sheetName ?? data.draft?.sheetName ?? '';
      setDraftUrl(url);
      setDraftSheetName(sheetName);
      if (action === 'save-draft') {
        setMessage(`Draft order saved${sheetName ? ` to ${sheetName}` : ''}.`);
      } else {
        setMessage(`Pushed to Cin7${data.reference ? ` as ${data.reference}` : ''}${data.purchaseOrderId ? ` (ID ${data.purchaseOrderId})` : ''}.`);
      }
    } catch (e: any) {
      setError(e.message ?? 'Order action failed.');
    }

    if (action === 'save-draft') setSaving(false);
    if (action === 'push-cin7') setPushing(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-xl">🧾</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Order Planner</h2>
            <p className="text-xs text-gray-500">Build reorder recommendations from Products sales velocity, then save to Draft Orders or push to Cin7.</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Group By</span>
            <select
              value={filterType}
              onChange={e => {
                setFilterType(e.target.value as FilterType);
                setFilterValue('');
                setFilterQuery('');
                setFilterMenuOpen(false);
                setRows([]);
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="supplier">Supplier</option>
              <option value="brand">Brand</option>
            </select>
          </label>

          <label className="block lg:col-span-2">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">{filterType === 'brand' ? 'Brand' : 'Supplier'}</span>
            <div className="relative">
              <input
                type="text"
                value={filterQuery}
                onFocus={() => setFilterMenuOpen(true)}
                onChange={e => {
                  const nextQuery = e.target.value;
                  setFilterQuery(nextQuery);
                  setFilterMenuOpen(true);
                  if (!nextQuery.trim()) {
                    setFilterValue('');
                    return;
                  }
                  const exact = currentFilterOptions.find(option => option.label.toLowerCase() === nextQuery.trim().toLowerCase());
                  setFilterValue(exact?.value ?? '');
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setFilterMenuOpen(false);
                    const selected = currentFilterOptions.find(option => option.value === filterValue);
                    if (!filterQuery.trim()) {
                      setFilterValue('');
                      setFilterQuery('');
                      return;
                    }
                    if (!selected) {
                      setFilterValue('');
                    }
                  }, 120);
                }}
                placeholder={`Type to filter ${filterType === 'brand' ? 'brands' : 'suppliers'}...`}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
              />
              {filterMenuOpen && visibleFilterOptions.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {visibleFilterOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        selectFilterOption(option.value);
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 ${filterValue === option.value ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700'}`}
                    >
                      <div className="font-medium">{option.label}</div>
                      {filterType === 'supplier' && (
                        <div className="text-xs text-gray-400">ID: {option.value}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {filterValue
                ? `Selected: ${currentFilterOptions.find(option => option.value === filterValue)?.label ?? filterQuery}`
                : ''}
            </p>
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Sales Window</span>
            <select
              value={salesWindowDays}
              onChange={e => setSalesWindowDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            >
              {WINDOW_OPTIONS.map(days => (
                <option key={days} value={days}>{days} days</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Supplier Lead Time (days)</span>
            <input
              type="number"
              min={0}
              value={leadTimeOverride}
              onChange={e => setLeadTimeOverride(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            />
            <p className="mt-1 text-xs text-gray-400">Override lead time for this plan build (0 = use supplier default).</p>
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Order Frequency (days)</span>
            <input
              type="number"
              min={1}
              value={orderFrequencyDays}
              onChange={e => setOrderFrequencyDays(Math.max(1, Number(e.target.value) || 1))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            />
          </label>

          <label className="block lg:col-span-2">
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Sales Source Branches</span>
            <select
              value={salesScope}
              onChange={e => setSalesScope(e.target.value as 'all' | 'selected')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="all">All branches</option>
              <option value="selected">Only selected branches</option>
            </select>
          </label>

          {salesScope === 'selected' && (
            <label className="block lg:col-span-2">
              <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Pick Branches For Sales</span>
              <select
                multiple
                value={salesBranchIds}
                onChange={e => {
                  const values = Array.from(e.target.selectedOptions).map(option => option.value);
                  setSalesBranchIds(values);
                }}
                className="w-full h-24 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
              >
                {(activeBranches.length > 0 ? activeBranches : branches).map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Hold Ctrl/Cmd to select multiple branches.</p>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={generatePlan}
            disabled={loading || !filterValue}
            className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Building…' : 'Build Order Plan'}
          </button>
          <button
            onClick={loadOptions}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Refresh Lists
          </button>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showZeroRows}
              onChange={e => setShowZeroRows(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            Show zero-qty rows
          </label>
        </div>

        <div className="border-t border-gray-100 pt-5 mt-5">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Logic</p>
            <p className="text-sm text-gray-700">Average daily sales = selected sales quantity ÷ actual days in stock, capped to the chosen window.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Coverage</p>
            <p className="text-sm text-gray-700">Suggested reorder = average daily sales × (order frequency + supplier lead time) minus available and incoming stock. Lead time defaults from the <strong>leadTimeDays</strong> column and can be overridden here.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Next Step</p>
            <p className="text-sm text-gray-700">Edit reorder quantities or costs directly in the table before saving a draft or pushing to Cin7.</p>
          </div>
        </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}
        {draftUrl && (
          <p className="mt-2 text-sm text-gray-600">
            Draft Orders spreadsheet: <a href={draftUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{draftSheetName || 'Open spreadsheet'}</a>
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-gray-800 text-base">Recommendation Lines</h3>
            <p className="text-xs text-gray-500">Rows with non-zero reorder quantities are shown by default.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="block min-w-52">
              <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Push To Branch</span>
              <select
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
              >
                <option value="">{branches.length > 0 ? 'Select branch…' : 'No Cin7 branches loaded'}</option>
                {(activeBranches.length > 0 ? activeBranches : branches).map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}{branch.isActive ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => persist('save-draft')}
              disabled={saving || rows.length === 0}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Draft Order'}
            </button>
            <button
              onClick={() => persist('push-cin7')}
              disabled={pushing || rows.length === 0 || !branchId}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {pushing ? 'Pushing…' : 'Push To Cin7'}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Lines</p>
            <p className="text-lg font-bold text-gray-800">{summary.totalLines}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Units</p>
            <p className="text-lg font-bold text-gray-800">{summary.totalUnits.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Estimated Cost</p>
            <p className="text-lg font-bold text-gray-800">${summary.totalValue.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Suppliers In Order</p>
            <p className={`text-lg font-bold ${summary.supplierCount > 1 ? 'text-orange-600' : 'text-gray-800'}`}>{summary.supplierCount}</p>
          </div>
        </div>

        {summary.supplierCount > 1 && (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            Multiple suppliers are included in the current rows. Saving works, but Cin7 push requires one supplier per order.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                {['Code', 'Product', 'Sales Qty', 'Avg/Day', 'Available', 'Incoming', 'Suggested', 'Pack Size', 'Reorder Qty', 'Cost', 'Line Value', 'Brand', 'Supplier', 'Created', 'Days In Stock'].map(label => (
                  <th key={label} className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-sm text-gray-400">
                    {rows.length === 0
                      ? 'Build an order plan to see recommendations.'
                      : (
                        <span>
                          All {rows.length} product{rows.length === 1 ? '' : 's'} have zero suggested reorder quantity.{' '}
                          <button
                            type="button"
                            onClick={() => setShowZeroRows(true)}
                            className="text-emerald-600 underline hover:text-emerald-700"
                          >
                            Show all rows
                          </button>
                        </span>
                      )
                    }
                  </td>
                </tr>
              )}
              {filteredRows.map(row => (
                <tr key={rowKey(row)} className="border-b border-gray-100 hover:bg-gray-50/70">
                  <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{row.code || '—'}</td>
                  <td className="px-3 py-2 min-w-52">
                    <div className="font-semibold text-gray-800">{row.name}</div>
                    <div className="text-gray-400">Option ID: {row.optionId || '—'}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.salesQty}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.avgDailySales}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.totalAvailable}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.totalIncoming}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-800">{row.suggestedQty}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{row.packSize > 0 ? row.packSize : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="number"
                      min={0}
                      value={row.reorderQty}
                      onChange={e => updateRow(rowKey(row), 'reorderQty', Math.max(0, Number(e.target.value) || 0))}
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg bg-white"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.cost}
                      onChange={e => updateRow(rowKey(row), 'cost', Math.max(0, Number(e.target.value) || 0))}
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg bg-white"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-800">${round(row.estimatedLineValue).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.brand || '—'}</td>
                  <td className="px-3 py-2 min-w-36">
                    <div className="text-gray-800">{row.supplierName || '—'}</div>
                    <div className="text-gray-400">{row.supplierId || 'No supplier id'}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.createdDate ? row.createdDate.slice(0, 10) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.daysInStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}