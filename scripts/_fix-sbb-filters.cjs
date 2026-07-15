// node scripts/_fix-sbb-filters.cjs
const fs = require('fs');
const file = 'src/app/ims/page.tsx';
let c = fs.readFileSync(file, 'utf8');
let changed = 0;

// ── 1. Replace MultiFilter state with simple string state ─────────────────
const oldState =
  "  const [filters, setFilters]  = useState<MultiFilter>(EMPTY_MULTI);\r\n" +
  "  const [dateRange, setDateRange] = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });\r\n" +
  "  const [page,     setPage]    = useState(1);\r\n" +
  "  const [pageSize, setPageSize] = useState(25);\r\n" +
  "  const [branchFilter, setBranchFilter] = useState<number | null>(null);";

const newState =
  "  const [filterText,     setFilterText]     = useState('');\r\n" +
  "  const [filterBrand,    setFilterBrand]    = useState('');\r\n" +
  "  const [filterSupplier, setFilterSupplier] = useState('');\r\n" +
  "  const [filterType,     setFilterType]     = useState('');\r\n" +
  "  const [brandsOptions,  setBrandsOptions]  = useState<string[]>([]);\r\n" +
  "  const [suppliersOptions, setSuppliersOptions] = useState<{ id: number; name: string }[]>([]);\r\n" +
  "  const [dateRange, setDateRange] = useState<SBDateRange>({ kind: 'window', window: 90, label: '90 Days' });\r\n" +
  "  const [page,     setPage]    = useState(1);\r\n" +
  "  const [pageSize, setPageSize] = useState(25);\r\n" +
  "  const [branchFilter, setBranchFilter] = useState<number | null>(null);";

if (!c.includes(oldState)) { console.error('state NOT FOUND'); process.exit(1); }
c = c.replace(oldState, newState);
changed++;

// ── 2. Replace load function signature ────────────────────────────────────
const oldLoad =
  "  const load = useCallback(async (pg: number, f: MultiFilter, dr: SBDateRange, ps: number, bid: number | null = null) => {";
const newLoad =
  "  const load = useCallback(async (pg: number, ft: string, fb: string, fs_: string, ftype: string, dr: SBDateRange, ps: number, bid: number | null = null) => {";

if (!c.includes(oldLoad)) { console.error('load sig NOT FOUND'); process.exit(1); }
c = c.replace(oldLoad, newLoad);
changed++;

// ── 3. Replace params building inside load ────────────────────────────────
const oldParams =
  "      const params = new URLSearchParams({ page: String(pg), pageSize: String(ps), ...multiFilterParams(f) });";
const newParams =
  "      const params = new URLSearchParams({ page: String(pg), pageSize: String(ps) });\r\n" +
  "      if (ft)    params.set('q',            ft);\r\n" +
  "      if (fb)    params.set('brand',         fb);\r\n" +
  "      if (fs_)   params.set('supplierName',  fs_);\r\n" +
  "      if (ftype) params.set('productType',   ftype);";

if (!c.includes(oldParams)) { console.error('params NOT FOUND'); process.exit(1); }
c = c.replace(oldParams, newParams);
changed++;

// ── 4. Store brands/suppliers from API response ───────────────────────────
const oldSetRows =
  "      setRows(data.rows ?? []);\r\n" +
  "      setTotal(data.total ?? 0);\r\n" +
  "      setLocations(data.locations ?? []);";
const newSetRows =
  "      setRows(data.rows ?? []);\r\n" +
  "      setTotal(data.total ?? 0);\r\n" +
  "      setLocations(data.locations ?? []);\r\n" +
  "      if (data.brands)    setBrandsOptions(data.brands);\r\n" +
  "      if (data.suppliers) setSuppliersOptions(data.suppliers);";

if (!c.includes(oldSetRows)) { console.error('setRows NOT FOUND'); process.exit(1); }
c = c.replace(oldSetRows, newSetRows);
changed++;

// ── 5. Replace load call handlers ─────────────────────────────────────────
const oldInit =
  "  useEffect(() => { load(1, EMPTY_MULTI, { kind: 'window', window: 90, label: '90 Days' }, 25, null); }, [load]);";
const newInit =
  "  useEffect(() => { load(1, '', '', '', '', { kind: 'window', window: 90, label: '90 Days' }, 25, null); }, [load]);";

if (!c.includes(oldInit)) { console.error('init effect NOT FOUND'); process.exit(1); }
c = c.replace(oldInit, newInit);
changed++;

// ── 6. Replace handler functions ──────────────────────────────────────────
const oldHandlers =
  "  const handleFilterChange = (f: MultiFilter) => { setFilters(f); setPage(1); load(1, f, dateRange, pageSize, branchFilter); };\r\n" +
  "  const handleDateChange   = (dr: SBDateRange) => { setDateRange(dr); setPage(1); load(1, filters, dr, pageSize, branchFilter); };\r\n" +
  "  const handleBranchChange = (bid: number | null) => { setBranchFilter(bid); setPage(1); load(1, filters, dateRange, pageSize, bid); };\r\n" +
  "  const goPage             = (pg: number)       => { setPage(pg); load(pg, filters, dateRange, pageSize, branchFilter); };\r\n" +
  "  const changePageSize     = (ps: number)       => { setPageSize(ps); setPage(1); load(1, filters, dateRange, ps, branchFilter); };";

const newHandlers =
  "  const reloadWith = (ft: string, fb: string, fs_: string, ftype: string, dr: SBDateRange, ps: number, bid: number | null) =>\r\n" +
  "    load(1, ft, fb, fs_, ftype, dr, ps, bid);\r\n" +
  "  const handleDateChange   = (dr: SBDateRange) => { setDateRange(dr); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dr, pageSize, branchFilter); };\r\n" +
  "  const handleBranchChange = (bid: number | null) => { setBranchFilter(bid); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dateRange, pageSize, bid); };\r\n" +
  "  const goPage             = (pg: number)       => { setPage(pg); load(pg, filterText, filterBrand, filterSupplier, filterType, dateRange, pageSize, branchFilter); };\r\n" +
  "  const changePageSize     = (ps: number)       => { setPageSize(ps); setPage(1); load(1, filterText, filterBrand, filterSupplier, filterType, dateRange, ps, branchFilter); };";

if (!c.includes(oldHandlers)) { console.error('handlers NOT FOUND'); process.exit(1); }
c = c.replace(oldHandlers, newHandlers);
changed++;

// ── 7. Replace the filter bar in JSX ──────────────────────────────────────
const oldFilterBar =
  "        <ReportMultiFilter filters={filters} onChange={handleFilterChange} showCategories={showCategories} />\r\n" +
  "        <SBDatePicker value={dateRange} onChange={handleDateChange} />\r\n" +
  "        {!loading && total > 0 && (\r\n" +
  "          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>\r\n" +
  "            {total.toLocaleString()} variant{total !== 1 ? 's' : ''}\r\n" +
  "          </span>\r\n" +
  "        )}\r\n" +
  "        {loading && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading\u2026</span>}\r\n" +
  "        {(hasMultiFilter(filters) || branchFilter !== null) && (\r\n" +
  "          <button onClick={() => { setBranchFilter(null); handleFilterChange(EMPTY_MULTI); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>\r\n" +
  "            Clear filters\r\n" +
  "          </button>\r\n" +
  "        )}";

const newFilterBar =
  "        <input\r\n" +
  "          placeholder=\"Search product or SKU\u2026\"\r\n" +
  "          value={filterText}\r\n" +
  "          onChange={e => { const v = e.target.value; setFilterText(v); setPage(1); load(1, v, filterBrand, filterSupplier, filterType, dateRange, pageSize, branchFilter); }}\r\n" +
  "          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterText ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, flex: '1 1 180px', minWidth: 160 }}\r\n" +
  "        />\r\n" +
  "        <input\r\n" +
  "          list=\"sbb-brand-list\"\r\n" +
  "          placeholder=\"All Brands\"\r\n" +
  "          value={filterBrand}\r\n" +
  "          onChange={e => { const v = e.target.value; setFilterBrand(v); setPage(1); load(1, filterText, v, filterSupplier, filterType, dateRange, pageSize, branchFilter); }}\r\n" +
  "          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterBrand ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, minWidth: 130 }}\r\n" +
  "        />\r\n" +
  "        <datalist id=\"sbb-brand-list\">\r\n" +
  "          {brandsOptions.map(b => <option key={b} value={b} />)}\r\n" +
  "        </datalist>\r\n" +
  "        <input\r\n" +
  "          list=\"sbb-supplier-list\"\r\n" +
  "          placeholder=\"All Suppliers\"\r\n" +
  "          value={filterSupplier}\r\n" +
  "          onChange={e => { const v = e.target.value; setFilterSupplier(v); setPage(1); load(1, filterText, filterBrand, v, filterType, dateRange, pageSize, branchFilter); }}\r\n" +
  "          style={{ height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: filterSupplier ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontSize: 12, minWidth: 130 }}\r\n" +
  "        />\r\n" +
  "        <datalist id=\"sbb-supplier-list\">\r\n" +
  "          {suppliersOptions.map(s => <option key={s.id} value={s.name} />)}\r\n" +
  "        </datalist>\r\n" +
  "        <SBDatePicker value={dateRange} onChange={handleDateChange} />\r\n" +
  "        {!loading && total > 0 && (\r\n" +
  "          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>\r\n" +
  "            {total.toLocaleString()} variant{total !== 1 ? 's' : ''}\r\n" +
  "          </span>\r\n" +
  "        )}\r\n" +
  "        {loading && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Loading\u2026</span>}\r\n" +
  "        {(filterText || filterBrand || filterSupplier || filterType || branchFilter !== null) && (\r\n" +
  "          <button onClick={() => { setFilterText(''); setFilterBrand(''); setFilterSupplier(''); setFilterType(''); setBranchFilter(null); setPage(1); load(1, '', '', '', '', dateRange, pageSize, null); }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--sv-etch)', background: 'none', cursor: 'pointer', color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>\r\n" +
  "            Clear filters\r\n" +
  "          </button>\r\n" +
  "        )}";

if (!c.includes(oldFilterBar)) { console.error('JSX filter bar NOT FOUND'); process.exit(1); }
c = c.replace(oldFilterBar, newFilterBar);
changed++;

// ── 8. Wrap Products filter bar with styled panel ─────────────────────────
const oldProductsBar =
  "      {/* \u2500\u2500 Filter bar \u2500\u2500 */}\r\n" +
  "      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>";
const newProductsBar =
  "      {/* \u2500\u2500 Filter bar \u2500\u2500 */}\r\n" +
  "      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>";

if (!c.includes(oldProductsBar)) { console.error('Products bar NOT FOUND'); process.exit(1); }
c = c.replace(oldProductsBar, newProductsBar);
changed++;

// ── 9. Wrap PO filter bar ─────────────────────────────────────────────────
const oldPoBar =
  "      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>\r\n" +
  "        {['','draft','confirmed','partially_received','complete','cancelled'].map(s => (";
const newPoBar =
  "      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>\r\n" +
  "        {['','draft','confirmed','partially_received','complete','cancelled'].map(s => (";

if (!c.includes(oldPoBar)) { console.error('PO bar NOT FOUND'); process.exit(1); }
c = c.replace(oldPoBar, newPoBar);
changed++;

// ── 10. Wrap SO filter bar ─────────────────────────────────────────────────
const oldSoBar =
  "      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>\r\n" +
  "        {['','draft','confirmed','fulfilled','cancelled'].map(s => (";
const newSoBar =
  "      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>\r\n" +
  "        {['','draft','confirmed','fulfilled','cancelled'].map(s => (";

if (!c.includes(oldSoBar)) { console.error('SO bar NOT FOUND'); process.exit(1); }
c = c.replace(oldSoBar, newSoBar);
changed++;

// ── 11. Wrap Stocktake filter bar ─────────────────────────────────────────
const oldStBar =
  "      {/* Filters */}\r\n" +
  "      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>\r\n" +
  "        <select value={filterLocation}";
const newStBar =
  "      {/* Filters */}\r\n" +
  "      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>\r\n" +
  "        <select value={filterLocation}";

if (!c.includes(oldStBar)) { console.error('Stocktake bar NOT FOUND'); process.exit(1); }
c = c.replace(oldStBar, newStBar);
changed++;

// Step 12 done manually
changed++;

fs.writeFileSync(file, c, 'utf8');
console.log(`Done — ${changed} changes applied`);
