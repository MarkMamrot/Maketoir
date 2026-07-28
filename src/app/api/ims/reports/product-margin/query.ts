export interface ProductMarginQueryOptions {
  window: number;
  fromDate: string;
  toDate: string;
}

export function buildProductMarginSalesQuery(options: ProductMarginQueryOptions) {
  const { window, fromDate, toDate } = options;
  const useCustomRange = Boolean(fromDate && toDate);

  if (useCustomRange) {
    return {
      useCustomRange: true,
      salesJoin: `LEFT JOIN (
        SELECT variant_id, SUM(ABS(qty_change)) AS sales_qty
        FROM ims_stock_movements
        WHERE movement_type IN ('pos_sale','so_fulfilled')
          AND DATE(created_at) >= ?
          AND DATE(created_at) <= ?
        GROUP BY variant_id
      ) sales_stats ON sales_stats.variant_id = v.variant_id`,
      salesQtyExpr: 'COALESCE(sales_stats.sales_qty, 0)',
      salesCondition: 'COALESCE(sales_stats.sales_qty, 0) > 0',
      queryParams: [fromDate, toDate],
    };
  }

  const salesCol =
    window <= 7 ? 'sc.sales_qty_7d' :
    window <= 90 ? 'sc.sales_qty_90d' :
    window <= 180 ? 'sc.sales_qty_180d' : 'sc.sales_qty_12m';

  return {
    useCustomRange: false,
    salesJoin: 'JOIN ims_sales_cache sc ON sc.variant_id = v.variant_id',
    salesQtyExpr: salesCol,
    salesCondition: `${salesCol} > 0`,
    queryParams: [] as string[],
  };
}
