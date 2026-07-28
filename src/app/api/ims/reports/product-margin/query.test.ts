import { describe, expect, it } from 'vitest';
import { buildProductMarginSalesQuery } from './query';

describe('buildProductMarginSalesQuery', () => {
  it('uses the sales cache for window-based ranges', () => {
    const result = buildProductMarginSalesQuery({ window: 90, fromDate: '', toDate: '' });

    expect(result.useCustomRange).toBe(false);
    expect(result.salesJoin).toContain('ims_sales_cache');
    expect(result.salesQtyExpr).toBe('sc.sales_qty_90d');
    expect(result.salesCondition).toBe('sc.sales_qty_90d > 0');
    expect(result.queryParams).toEqual([]);
  });

  it('uses a live movement-based query for custom ranges', () => {
    const result = buildProductMarginSalesQuery({ window: 90, fromDate: '2024-01-01', toDate: '2024-01-31' });

    expect(result.useCustomRange).toBe(true);
    expect(result.salesJoin).toContain('ims_stock_movements');
    expect(result.salesQtyExpr).toBe('COALESCE(sales_stats.sales_qty, 0)');
    expect(result.salesCondition).toBe('COALESCE(sales_stats.sales_qty, 0) > 0');
    expect(result.queryParams).toEqual(['2024-01-01', '2024-01-31']);
  });
});
