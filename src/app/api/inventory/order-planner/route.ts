import { NextResponse } from 'next/server';
import { execute } from '@/services/MySQLService';
import { getProductsWithSales, getSuppliers, getBranches, getStockPerBranch } from '@/lib/dataProvider';
import type { StandardizedVariantWithSales, StandardizedContact, StandardizedLocation, VariantBranchStock } from '@/types/StandardizedData';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

const SALES_FIELD_BY_WINDOW: Record<number, keyof StandardizedVariantWithSales> = {
  7: 'sales_qty_7d',
  90: 'sales_qty_90d',
  180: 'sales_qty_180d',
  365: 'sales_qty_12m',
};

const DRAFT_HEADERS = [
  'createdAt',
  'filterType',
  'filterValue',
  'salesWindowDays',
  'orderFrequencyDays',
  'deliveryBufferDays',
  'branchId',
  'branchName',
  'cin7PurchaseOrderId',
  'cin7Reference',
  'productId',
  'optionId',
  'code',
  'name',
  'brand',
  'supplierId',
  'supplierName',
  'createdDate',
  'daysInStock',
  'effectiveSalesDays',
  'totalSOH',
  'totalAvailable',
  'totalIncoming',
  'salesQty',
  'avgDailySales',
  'suggestedQty',
  'packSize',
  'reorderQty',
  'cost',
  'estimatedLineValue',
];

type PlannerFilterType = 'brand' | 'supplier';

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseNumber(value: unknown): number {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeSheetTitle(raw: string): string {
  const base = raw.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Draft Order';
  return base.slice(0, 90);
}

function buildSupplierLeadTimeMap(suppliers: StandardizedContact[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const s of suppliers) {
    if (s.lead_time_days != null && s.lead_time_days >= 0) {
      result.set(s.source_id, s.lead_time_days);
    }
  }
  return result;
}

function buildSupplierNameMap(suppliers: StandardizedContact[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const s of suppliers) {
    result.set(s.source_id, s.company || s.name || `Supplier ${s.source_id}`);
  }
  return result;
}

function applySupplierLeadTimeOverrides(baseMap: Map<string, number>, overrides: Record<string, unknown>): Map<string, number> {
  const merged = new Map(baseMap);
  if (!overrides || typeof overrides !== 'object') return merged;

  // __global key = override all suppliers with this single value
  if ('__global' in overrides) {
    const globalVal = Number(overrides['__global']);
    if (Number.isFinite(globalVal) && globalVal >= 0) {
      const rounded = Math.round(globalVal);
      for (const key of merged.keys()) merged.set(key, rounded);
      // Also store as default for any supplier not yet in the map
      merged.set('__global', rounded);
    }
    return merged;
  }

  for (const [supplierIdRaw, valueRaw] of Object.entries(overrides)) {
    const supplierId = String(supplierIdRaw ?? '').trim();
    if (!supplierId) continue;
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value < 0) continue;
    merged.set(supplierId, Math.round(value));
  }

  return merged;
}

function buildFilterOptions(products: StandardizedVariantWithSales[], supplierNameMap: Map<string, string>) {
  const brandSet = new Set<string>();
  const supplierSet = new Set<string>();
  for (const p of products) {
    if (p.brand) brandSet.add(p.brand);
    if (p.supplier_id) supplierSet.add(p.supplier_id);
  }
  return {
    brands: [...brandSet].sort((a, b) => a.localeCompare(b)),
    suppliers: [...supplierSet]
      .map(id => ({ id, label: supplierNameMap.get(id) ?? `Supplier ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function buildPlannerRows(args: {
  products: StandardizedVariantWithSales[];
  stockPerBranch: VariantBranchStock[];
  supplierNameMap: Map<string, string>;
  supplierLeadTimeMap: Map<string, number>;
  filterType: PlannerFilterType;
  filterValue: string;
  salesWindowDays: number;
  orderFrequencyDays: number;
  salesBranchIds: string[];
}): PlannerRow[] {
  const {
    products, stockPerBranch, supplierNameMap, supplierLeadTimeMap,
    filterType, filterValue, salesWindowDays, orderFrequencyDays, salesBranchIds,
  } = args;
  if (products.length === 0) return [];

  // Build per-variant filtered stock when a branch filter is active
  const filteredStockMap = new Map<string, { soh: number; available: number; incoming: number }>();
  if (salesBranchIds.length > 0) {
    for (const s of stockPerBranch) {
      if (!salesBranchIds.includes(s.branch_id)) continue;
      const existing = filteredStockMap.get(s.variant_id);
      if (!existing) {
        filteredStockMap.set(s.variant_id, { soh: s.soh, available: s.available, incoming: s.incoming });
      } else {
        existing.soh += s.soh;
        existing.available += s.available;
        existing.incoming += s.incoming;
      }
    }
  }

  const salesField = SALES_FIELD_BY_WINDOW[salesWindowDays] ?? 'sales_qty_90d';
  const now = Date.now();

  return products
    .map((p): PlannerRow | null => {
      const supplierId = String(p.supplier_id ?? '');
      const brand = p.brand ?? '';
      const filterMatch = filterType === 'brand' ? brand === filterValue : supplierId === filterValue;
      if (!filterMatch) return null;

      const optId = p.source_id;
      const branchStock = salesBranchIds.length > 0 ? filteredStockMap.get(optId) : null;
      const totalSOH = round(branchStock ? branchStock.soh : p.qty_on_hand, 2);
      const totalAvailable = round(branchStock ? branchStock.available : p.global_available, 2);
      const totalIncoming = round(branchStock ? branchStock.incoming : p.qty_incoming, 2);
      const salesQty = round(Number((p as any)[salesField] ?? 0), 2);
      const createdDate = p.created_date ?? '';
      const createdAt = createdDate ? new Date(createdDate).getTime() : Number.NaN;
      const leadTimeDays = supplierLeadTimeMap.get(supplierId) ?? supplierLeadTimeMap.get('__global') ?? 0;
      const coverageDays = Math.max(1, orderFrequencyDays) + Math.max(0, leadTimeDays);
      const adjustedStart = Number.isFinite(createdAt) ? createdAt + (Math.max(0, leadTimeDays) * DAY_MS) : Number.NaN;
      const stockDays = Number.isFinite(adjustedStart) ? Math.max(0, Math.floor((now - adjustedStart) / DAY_MS)) : salesWindowDays;
      const effectiveSalesDays = Math.min(salesWindowDays, stockDays || salesWindowDays);
      const avgDailySales = effectiveSalesDays > 0 ? round(salesQty / effectiveSalesDays, 4) : 0;
      const suggestedQty = Math.max(0, Math.ceil((avgDailySales * coverageDays) - totalAvailable - totalIncoming));
      const cost = round(Number(p.cost ?? 0));
      const packSize = Math.max(0, Math.round(Number(p.pack_size ?? 0)));
      const reorderQty = packSize > 0 && suggestedQty > 0
        ? Math.max(packSize, Math.round(suggestedQty / packSize) * packSize)
        : suggestedQty;

      return {
        productId: p.parent_source_id ?? p.source_id,
        optionId: optId,
        code: p.sku ?? '',
        name: p.name ?? '',
        brand,
        supplierId,
        supplierName: supplierNameMap.get(supplierId) ?? (supplierId ? `Supplier ${supplierId}` : 'Unassigned'),
        createdDate,
        daysInStock: stockDays,
        effectiveSalesDays,
        totalSOH,
        totalAvailable,
        totalIncoming,
        salesQty,
        avgDailySales,
        leadTimeDays,
        coverageDays,
        suggestedQty,
        packSize,
        reorderQty,
        cost,
        estimatedLineValue: round(reorderQty * cost),
      };
    })
    .filter((r): r is PlannerRow => r !== null)
    .sort((a, b) => {
      if (b.reorderQty !== a.reorderQty) return b.reorderQty - a.reorderQty;
      return a.name.localeCompare(b.name);
    });
}

async function loadContext(databaseId: string) {
  const [products, suppliers, branches, stockPerBranch] = await Promise.all([
    getProductsWithSales(databaseId, 'solvantis').catch(() => [] as StandardizedVariantWithSales[]),
    getSuppliers(databaseId, 'solvantis').catch(() => [] as StandardizedContact[]),
    getBranches(databaseId, 'solvantis').catch(() => [] as StandardizedLocation[]),
    getStockPerBranch(databaseId, 'solvantis').catch(() => [] as VariantBranchStock[]),
  ]);
  return { products, suppliers, branches, stockPerBranch };
}

async function saveDraftOrder(args: {
  databaseId: string;
  filterType: PlannerFilterType;
  filterValue: string;
  salesWindowDays: number;
  orderFrequencyDays: number;
  branchId?: string;
  branchName?: string;
  rows: PlannerRow[];
  cin7PurchaseOrderId?: string;
  cin7Reference?: string;
}) {
  const {
    databaseId,
    filterType,
    filterValue,
    salesWindowDays,
    orderFrequencyDays,
    branchId = '',
    branchName = '',
    rows,
    cin7PurchaseOrderId = '',
    cin7Reference = '',
  } = args;

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const rawTitle = `${stamp} ${filterType === 'brand' ? 'Brand' : 'Supplier'} ${filterValue}`;
  const sheetName = safeSheetTitle(rawTitle);

  // Auto-create the table if it doesn’t exist
  await execute(
    `CREATE TABLE IF NOT EXISTS order_planner_drafts (
       id                    INT          NOT NULL AUTO_INCREMENT,
       database_id           VARCHAR(255) NOT NULL,
       draft_name            VARCHAR(255) NOT NULL,
       filter_type           VARCHAR(50)  NOT NULL,
       filter_value          VARCHAR(255) NOT NULL,
       sales_window_days     INT          NOT NULL,
       order_frequency_days  INT          NOT NULL,
       branch_id             VARCHAR(100) NOT NULL DEFAULT '',
       branch_name           VARCHAR(255) NOT NULL DEFAULT '',
       cin7_po_id            VARCHAR(100) NOT NULL DEFAULT '',
       cin7_reference        VARCHAR(255) NOT NULL DEFAULT '',
       rows_json             LONGTEXT     NOT NULL,
       created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       INDEX idx_database_id (database_id)
     ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    [],
  );

  const result = await execute(
    `INSERT INTO order_planner_drafts
       (database_id, draft_name, filter_type, filter_value,
        sales_window_days, order_frequency_days, branch_id, branch_name,
        cin7_po_id, cin7_reference, rows_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      databaseId,
      sheetName,
      filterType,
      filterValue,
      salesWindowDays,
      orderFrequencyDays,
      branchId,
      branchName,
      cin7PurchaseOrderId,
      cin7Reference,
      JSON.stringify(rows),
    ],
  ) as any;

  return {
    spreadsheetId:  null,
    spreadsheetUrl: '',        // empty — no Google Sheets link
    sheetName,
    draftId: result?.insertId ?? null,
  };
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const action = String(body?.action ?? 'preview');
  const databaseId = String(body?.databaseId ?? '').trim();
  const filterType = (body?.filterType === 'brand' ? 'brand' : 'supplier') as PlannerFilterType;
  const filterValue = String(body?.filterValue ?? '').trim();
  const salesWindowDays = Number(body?.salesWindowDays) || 90;
  const orderFrequencyDays = Math.max(1, Number(body?.orderFrequencyDays) || 30);
  const branchId = String(body?.branchId ?? '').trim();
  const branchName = String(body?.branchName ?? '').trim();
  const salesBranchIds = Array.isArray(body?.salesBranchIds)
    ? body.salesBranchIds.map((v: any) => String(v ?? '').trim()).filter(Boolean)
    : [];
  const editedRows = Array.isArray(body?.rows) ? body.rows : [];
  const supplierLeadTimeOverrides = (body?.supplierLeadTimeOverrides && typeof body.supplierLeadTimeOverrides === 'object')
    ? body.supplierLeadTimeOverrides as Record<string, unknown>
    : {};

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    const context = await loadContext(databaseId);
    if (context.products.length === 0) {
      return NextResponse.json({ success: false, error: 'No products found. Run Sync Inventory → Product Data first.' }, { status: 400 });
    }

    const supplierNameMap = buildSupplierNameMap(context.suppliers);
    const supplierLeadTimeMap = applySupplierLeadTimeOverrides(
      buildSupplierLeadTimeMap(context.suppliers),
      supplierLeadTimeOverrides,
    );
    const options = buildFilterOptions(context.products, supplierNameMap);
    const branches: BranchOption[] = context.branches
      .filter(b => b.source_id && b.name)
      .map(b => ({ id: b.source_id, name: b.name, isActive: b.is_active }));

    if (action === 'preview') {
      const rows = filterValue
        ? buildPlannerRows({
            products: context.products,
            stockPerBranch: context.stockPerBranch,
            supplierNameMap,
            supplierLeadTimeMap,
            filterType,
            filterValue,
            salesWindowDays,
            orderFrequencyDays,
            salesBranchIds,
          })
        : [];

      return NextResponse.json({
        success: true,
        options,
        supplierLeadTimes: Object.fromEntries(supplierLeadTimeMap.entries()),
        selectedSalesBranches: salesBranchIds,
        branches,
        rows,
        summary: {
          totalRows: rows.length,
          totalUnits: rows.reduce((sum, row) => sum + row.reorderQty, 0),
          totalValue: round(rows.reduce((sum, row) => sum + row.estimatedLineValue, 0)),
        },
      });
    }

    const normalizedRows: PlannerRow[] = editedRows.map((row: any) => ({
      productId: String(row?.productId ?? '').trim(),
      optionId: String(row?.optionId ?? '').trim(),
      code: String(row?.code ?? '').trim(),
      name: String(row?.name ?? '').trim(),
      brand: String(row?.brand ?? '').trim(),
      supplierId: String(row?.supplierId ?? '').trim(),
      supplierName: String(row?.supplierName ?? '').trim(),
      createdDate: String(row?.createdDate ?? '').trim(),
      daysInStock: parseNumber(row?.daysInStock),
      effectiveSalesDays: parseNumber(row?.effectiveSalesDays),
      totalSOH: parseNumber(row?.totalSOH),
      totalAvailable: parseNumber(row?.totalAvailable),
      totalIncoming: parseNumber(row?.totalIncoming),
      salesQty: parseNumber(row?.salesQty),
      avgDailySales: parseNumber(row?.avgDailySales),
      leadTimeDays: Math.max(0, Math.round(parseNumber(row?.leadTimeDays))),
      coverageDays: Math.max(1, Math.round(parseNumber(row?.coverageDays) || (orderFrequencyDays + parseNumber(row?.leadTimeDays)))),
      suggestedQty: Math.max(0, Math.round(parseNumber(row?.suggestedQty))),
      packSize: Math.max(0, Math.round(parseNumber(row?.packSize))),
      reorderQty: Math.max(0, Math.round(parseNumber(row?.reorderQty))),
      cost: round(parseNumber(row?.cost)),
      estimatedLineValue: round(parseNumber(row?.reorderQty) * parseNumber(row?.cost)),
    })).filter((row: PlannerRow) => row.code || row.name || row.optionId);

    if (normalizedRows.length === 0) {
      return NextResponse.json({ success: false, error: 'No order rows were provided.' }, { status: 400 });
    }

    if (action === 'save-draft') {
      const draft = await saveDraftOrder({
        databaseId,
        filterType,
        filterValue,
        salesWindowDays,
        orderFrequencyDays,
        branchId,
        branchName,
        rows: normalizedRows,
      });
      return NextResponse.json({ success: true, ...draft });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
