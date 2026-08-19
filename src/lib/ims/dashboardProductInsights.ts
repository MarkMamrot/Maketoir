export interface DashboardProductInsight {
  variant_id: string;
  product_name: string;
  option_label: string;
  sku: string;
  units_sold: number;
  revenue: number;
  stock_on_hand: number;
}

export function buildDashboardProductInsights(
  topRows: DashboardProductInsight[],
  slowRows: DashboardProductInsight[],
  limit = 5,
): { top: DashboardProductInsight[]; slow: DashboardProductInsight[] } {
  const normalise = (row: DashboardProductInsight): DashboardProductInsight => ({
    ...row,
    units_sold: Number(row.units_sold ?? 0),
    revenue: Number(row.revenue ?? 0),
    stock_on_hand: Number(row.stock_on_hand ?? 0),
  });
  const top = topRows.slice(0, limit).map(normalise);
  const topIds = new Set(top.map(row => row.variant_id));
  const slowCandidates = slowRows
    .map(normalise)
    .sort((left, right) => left.units_sold - right.units_sold || left.product_name.localeCompare(right.product_name));
  const percentileIndex = Math.max(0, Math.ceil(slowCandidates.length * 0.1) - 1);
  const slowSalesBoundary = slowCandidates[percentileIndex]?.units_sold;
  const slow = slowCandidates
    .filter(row => slowSalesBoundary != null && row.units_sold <= slowSalesBoundary && row.stock_on_hand > 0 && !topIds.has(row.variant_id))
    .sort((left, right) => right.stock_on_hand - left.stock_on_hand || left.units_sold - right.units_sold || left.product_name.localeCompare(right.product_name))
    .slice(0, limit);
  return { top, slow };
}