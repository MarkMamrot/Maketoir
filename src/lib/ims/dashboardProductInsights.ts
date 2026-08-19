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
  limit = 3,
): { top: DashboardProductInsight[]; slow: DashboardProductInsight[] } {
  const normalise = (row: DashboardProductInsight): DashboardProductInsight => ({
    ...row,
    units_sold: Number(row.units_sold ?? 0),
    revenue: Number(row.revenue ?? 0),
    stock_on_hand: Number(row.stock_on_hand ?? 0),
  });
  const top = topRows.slice(0, limit).map(normalise);
  const topIds = new Set(top.map(row => row.variant_id));
  const slow = slowRows.filter(row => !topIds.has(row.variant_id)).slice(0, limit).map(normalise);
  return { top, slow };
}