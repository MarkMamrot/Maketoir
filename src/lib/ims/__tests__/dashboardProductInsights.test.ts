import { describe, expect, it } from 'vitest';

import { buildDashboardProductInsights, type DashboardProductInsight } from '../dashboardProductInsights';

function product(variantId: string, unitsSold: number | string, stockOnHand: number | string): DashboardProductInsight {
  return {
    variant_id: variantId,
    product_name: `Product ${variantId}`,
    option_label: '',
    sku: variantId,
    units_sold: unitsSold as number,
    revenue: '125.50' as unknown as number,
    stock_on_hand: stockOnHand as number,
  };
}

describe('buildDashboardProductInsights', () => {
  it('normalises database numeric values and excludes top sellers from slow movers', () => {
    const result = buildDashboardProductInsights(
      [product('top-1', '12', '4'), product('top-2', '8', '6')],
      [product('top-1', '12', '4'), product('slow-1', '0', '45'), product('slow-2', '1', '30')],
    );

    expect(result.top[0]).toMatchObject({ variant_id: 'top-1', units_sold: 12, revenue: 125.5, stock_on_hand: 4 });
    expect(result.slow.map(row => row.variant_id)).toEqual(['slow-1', 'slow-2']);
    expect(result.slow[0]).toMatchObject({ units_sold: 0, stock_on_hand: 45 });
  });

  it('applies the requested result limit to both groups', () => {
    const rows = [product('a', 4, 1), product('b', 3, 2), product('c', 2, 3)];
    const result = buildDashboardProductInsights(rows, rows.slice().reverse(), 2);

    expect(result.top).toHaveLength(2);
    expect(result.slow.map(row => row.variant_id)).toEqual(['c']);
  });
});