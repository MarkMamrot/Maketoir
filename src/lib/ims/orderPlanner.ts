const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReorderSuggestionInput {
  salesQuantity: number;
  salesWindowDays: number;
  createdDate?: string | null;
  supplierLeadTimeDays: number;
  orderFrequencyDays: number;
  availableQuantity: number;
  incomingQuantity: number;
  packSize: number;
  now?: number;
}

export interface ReorderSuggestion {
  daysInStock: number;
  effectiveSalesDays: number;
  averageDailySales: number;
  coverageDays: number;
  suggestedQuantity: number;
  reorderQuantity: number;
}

export interface OrderPlannerRow {
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
  totalSOH: number | null;
  totalAvailable: number | null;
  totalIncoming: number | null;
  salesQty: number;
  avgDailySales: number;
  leadTimeDays: number;
  coverageDays: number;
  suggestedQty: number | null;
  packSize: number;
  reorderQty: number;
  cost: number;
  estimatedLineValue: number;
  missingStockBranchIds: string[];
  stockChecked: boolean;
  salesBranchIds: string[];
}

export function buildPlannerBranchStockMap(stock: VariantBranchStock[], branchIds: string[]) {
  const selected = new Set(branchIds);
  const totals = new Map<string, { soh: number; available: number; incoming: number; branches: Set<string> }>();
  for (const row of stock) {
    if (!selected.has(row.branch_id)) continue;
    const total = totals.get(row.variant_id) ?? { soh: 0, available: 0, incoming: 0, branches: new Set<string>() };
    total.soh += Number(row.soh);
    total.available += Number(row.available);
    total.incoming += Number(row.incoming);
    total.branches.add(row.branch_id);
    totals.set(row.variant_id, total);
  }
  return new Map([...totals].map(([variantId, total]) => [variantId, {
    soh: total.soh,
    available: total.available,
    incoming: total.incoming,
    missingStockBranchIds: [...selected].filter(id => !total.branches.has(id)),
  }]));
}

export function buildPlannerRows(args: {
  products: StandardizedVariantWithSales[];
  stockPerBranch: VariantBranchStock[];
  supplierNameMap: Map<string, string>;
  supplierLeadTimeMap: Map<string, number>;
  filterType: 'brand' | 'supplier';
  filterValue: string;
  salesWindowDays: number;
  orderFrequencyDays: number;
  salesBranchIds: string[];
  branchSalesQuantities: ReadonlyMap<string, number>;
}): OrderPlannerRow[] {
  const selectedBranches = [...new Set(args.salesBranchIds)];
  const stockMap = buildPlannerBranchStockMap(args.stockPerBranch, selectedBranches);
  const salesFields = {
    7: 'sales_qty_7d', 90: 'sales_qty_90d', 180: 'sales_qty_180d', 365: 'sales_qty_12m',
  } as const;
  const salesField = salesFields[args.salesWindowDays as keyof typeof salesFields] ?? 'sales_qty_90d';
  return args.products.filter(product => args.filterType === 'brand'
    ? product.brand === args.filterValue
    : String(product.supplier_id ?? '') === args.filterValue).map(product => {
    const stock = stockMap.get(product.source_id);
    const missingStockBranchIds = selectedBranches.length > 0
      ? stock?.missingStockBranchIds ?? selectedBranches
      : [];
    const incomplete = missingStockBranchIds.length > 0;
    const supply = selectedBranches.length > 0 ? stock : {
      soh: product.qty_on_hand, available: product.global_available, incoming: product.qty_incoming,
    };
    const totalSOH = !incomplete && supply ? round(supply.soh) : null;
    const totalAvailable = !incomplete && supply ? round(supply.available) : null;
    const totalIncoming = !incomplete && supply ? round(supply.incoming) : null;
    const salesQty = round(selectedBranches.length
      ? args.branchSalesQuantities.get(product.source_id) ?? 0
      : Number(product[salesField]));
    const supplierId = String(product.supplier_id ?? '');
    const leadTimeDays = args.supplierLeadTimeMap.get(supplierId) ?? args.supplierLeadTimeMap.get('__global') ?? 0;
    const packSize = Math.max(0, Math.round(Number(product.pack_size ?? 0)));
    const suggestion = calculateReorderSuggestion({
      salesQuantity: salesQty,
      salesWindowDays: args.salesWindowDays,
      createdDate: product.created_date,
      supplierLeadTimeDays: leadTimeDays,
      orderFrequencyDays: args.orderFrequencyDays,
      availableQuantity: totalAvailable ?? 0,
      incomingQuantity: totalIncoming ?? 0,
      packSize,
    });
    const cost = round(Number(product.cost ?? 0));
    const reorderQty = incomplete ? 0 : suggestion.reorderQuantity;
    return {
      productId: product.parent_source_id ?? product.source_id,
      optionId: product.source_id,
      code: product.sku ?? '',
      name: product.name ?? '',
      brand: product.brand ?? '',
      supplierId,
      supplierName: args.supplierNameMap.get(supplierId) ?? (supplierId ? `Supplier ${supplierId}` : 'Unassigned'),
      createdDate: product.created_date ?? '',
      daysInStock: suggestion.daysInStock,
      effectiveSalesDays: suggestion.effectiveSalesDays,
      totalSOH, totalAvailable, totalIncoming, salesQty,
      avgDailySales: suggestion.averageDailySales,
      leadTimeDays,
      coverageDays: suggestion.coverageDays,
      suggestedQty: incomplete ? null : suggestion.suggestedQuantity,
      packSize, reorderQty, cost,
      estimatedLineValue: round(reorderQty * cost),
      missingStockBranchIds,
      stockChecked: false,
      salesBranchIds: selectedBranches,
    };
  }).sort((a, b) => b.reorderQty - a.reorderQty || a.name.localeCompare(b.name));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function calculateReorderSuggestion(input: ReorderSuggestionInput): ReorderSuggestion {
  const salesWindowDays = Math.max(1, Math.round(input.salesWindowDays));
  const leadTimeDays = Math.max(0, Math.round(input.supplierLeadTimeDays));
  const coverageDays = Math.max(1, Math.round(input.orderFrequencyDays)) + leadTimeDays;
  const createdAt = input.createdDate ? new Date(input.createdDate).getTime() : Number.NaN;
  const adjustedStart = Number.isFinite(createdAt) ? createdAt + leadTimeDays * DAY_MS : Number.NaN;
  const daysInStock = Number.isFinite(adjustedStart)
    ? Math.max(0, Math.floor(((input.now ?? Date.now()) - adjustedStart) / DAY_MS))
    : salesWindowDays;
  const effectiveSalesDays = Math.min(salesWindowDays, daysInStock || salesWindowDays);
  const averageDailySales = effectiveSalesDays > 0
    ? round(Math.max(0, input.salesQuantity) / effectiveSalesDays, 4)
    : 0;
  const suggestedQuantity = Math.max(0, Math.ceil(
    averageDailySales * coverageDays - input.availableQuantity - input.incomingQuantity,
  ));
  const packSize = Math.max(0, Math.round(input.packSize));
  const reorderQuantity = packSize > 0 && suggestedQuantity > 0
    ? Math.max(packSize, Math.round(suggestedQuantity / packSize) * packSize)
    : suggestedQuantity;

  return {
    daysInStock,
    effectiveSalesDays,
    averageDailySales,
    coverageDays,
    suggestedQuantity,
    reorderQuantity,
  };
}
import type { StandardizedVariantWithSales, VariantBranchStock } from '@/types/StandardizedData';
