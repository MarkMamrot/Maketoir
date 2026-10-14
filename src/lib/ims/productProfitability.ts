import { csvCell, numberOrNull, summarise, type ReportRow } from './cogsTraceability/domain';

export interface ProfitabilityProduct {
  variantId: string;
  sku: string;
  name: string;
  brand: string | null;
  supplierId: number | null;
  productType: string | null;
  category: string | null;
  subcategory: string | null;
}

export interface ProfitabilityFilters {
  productId?: string;
  brand?: string;
  supplierId?: string;
  productType?: string;
  category?: string;
  subcategory?: string;
}

export interface ProfitabilityRow {
  variantId: string | null;
  sku: string;
  name: string;
  brand: string | null;
  qty: number;
  rev: number | null;
  cogs: number | null;
  profit: number | null;
  margin: number | null;
  records: number;
  missingCosts: number;
  missingRevenue: number;
}

export function buildProductProfitability(
  detail: ReportRow[], products: ProfitabilityProduct[], filters: ProfitabilityFilters = {},
) {
  const byId = new Map(products.map(product => [product.variantId, product]));
  const bySku = new Map(products.map(product => [product.sku, product]));
  const buckets = new Map<string, { product: ProfitabilityProduct | undefined; rows: ReportRow[] }>();
  const included: ReportRow[] = [];
  let excludedNonProductRecords = 0;
  for (const row of detail) {
    if (!row.variantId && !row.sku) {
      excludedNonProductRecords++;
      continue;
    }
    const product = (row.variantId ? byId.get(row.variantId) : undefined)
      ?? (row.sku ? bySku.get(String(row.sku)) : undefined);
    if (filters.productId && (product?.variantId ?? row.variantId) !== filters.productId) continue;
    if (filters.brand && (product?.brand ?? row.brand) !== filters.brand) continue;
    if (filters.supplierId && String(product?.supplierId ?? '') !== filters.supplierId) continue;
    if (filters.productType && product?.productType !== filters.productType) continue;
    if (filters.category && product?.category !== filters.category) continue;
    if (filters.subcategory && product?.subcategory !== filters.subcategory) continue;
    const key = product?.variantId ?? row.variantId ?? `sku:${row.sku}`;
    const bucket = buckets.get(key) ?? { product, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
    included.push(row);
  }
  const rows: ProfitabilityRow[] = Array.from(buckets.values(), ({ product, rows: members }) => {
    const totals = summarise(members);
    return {
      variantId: product?.variantId ?? members[0].variantId ?? null,
      sku: product?.sku ?? String(members[0].sku ?? ''),
      name: product?.name ?? String(members[0].description ?? 'Unmatched product'),
      brand: product?.brand ?? (members[0].brand == null ? null : String(members[0].brand)),
      qty: totals.qty, rev: totals.netSales, cogs: totals.cogs, profit: totals.gp, margin: totals.gpPercent,
      records: totals.rows, missingCosts: totals.missingCosts, missingRevenue: totals.missingRevenue,
    };
  });
  rows.sort((left, right) => {
    if (left.profit == null && right.profit != null) return 1;
    if (left.profit != null && right.profit == null) return -1;
    return (right.profit ?? 0) - (left.profit ?? 0) || left.sku.localeCompare(right.sku);
  });
  const summary = summarise(included);
  return { rows, summary, excludedNonProductRecords };
}

export function productProfitabilityCsv(rows: ProfitabilityRow[]): string {
  const rounded = (value: number | null, places = 2) => value == null ? null : Number(value.toFixed(places));
  const headers = ['SKU', 'Product Name', 'Brand', 'Net Qty', 'Net Revenue (AUD ex GST)', 'Captured COGS (AUD)',
    'Gross Profit (AUD ex GST)', 'Margin %', 'Sale Records', 'Missing Cost Records', 'Missing Revenue Records', 'Evidence'];
  return [headers.map(csvCell).join(','), ...rows.map(row => [
    row.sku, row.name, row.brand, row.qty, rounded(row.rev), rounded(row.cogs), rounded(row.profit), rounded(numberOrNull(row.margin), 4),
    row.records, row.missingCosts, row.missingRevenue,
    row.missingCosts || row.missingRevenue ? 'Incomplete' : 'Complete',
  ].map(csvCell).join(','))].join('\r\n');
}
