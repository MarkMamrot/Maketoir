export interface DashboardProductInsight {
  variant_id: string;
  product_name: string;
  option_label: string;
  sku: string;
  units_sold: number;
  revenue: number;
  stock_on_hand: number;
  stock_value: number;
}

export type DashboardProductInsightMode = 'qty' | 'value';

export function buildDashboardProductInsights(
  topRows: DashboardProductInsight[],
  slowRows: DashboardProductInsight[],
  limit = 5,
  mode: DashboardProductInsightMode = 'qty',
): { top: DashboardProductInsight[]; slow: DashboardProductInsight[] } {
  const normalise = (row: DashboardProductInsight): DashboardProductInsight => ({
    ...row,
    units_sold: Number(row.units_sold ?? 0),
    revenue: Number(row.revenue ?? 0),
    stock_on_hand: Number(row.stock_on_hand ?? 0),
    stock_value: Number(row.stock_value ?? 0),
  });
  const salesMetric = (row: DashboardProductInsight) => mode === 'value' ? row.revenue : row.units_sold;
  const stockMetric = (row: DashboardProductInsight) => mode === 'value' ? row.stock_value : row.stock_on_hand;
  const top = topRows
    .map(normalise)
    .sort((left, right) => salesMetric(right) - salesMetric(left) || right.units_sold - left.units_sold || left.product_name.localeCompare(right.product_name))
    .slice(0, limit);
  const topIds = new Set(top.map(row => row.variant_id));
  const slowCandidates = slowRows
    .map(normalise)
    .sort((left, right) => salesMetric(left) - salesMetric(right) || left.product_name.localeCompare(right.product_name));
  const percentileIndex = Math.max(0, Math.ceil(slowCandidates.length * 0.1) - 1);
  const slowSalesBoundary = slowCandidates[percentileIndex] ? salesMetric(slowCandidates[percentileIndex]) : null;
  const slow = slowCandidates
    .filter(row => slowSalesBoundary != null && salesMetric(row) <= slowSalesBoundary && stockMetric(row) > 0 && !topIds.has(row.variant_id))
    .sort((left, right) => stockMetric(right) - stockMetric(left) || salesMetric(left) - salesMetric(right) || left.product_name.localeCompare(right.product_name))
    .slice(0, limit);
  return { top, slow };
}