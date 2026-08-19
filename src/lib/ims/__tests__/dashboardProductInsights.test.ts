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
      [
        product('slow-1', '0', '45'),
        product('slow-2', '0', '30'),
        ...Array.from({ length: 18 }, (_, index) => product(`seller-${index}`, index + 1, 100 - index)),
      ],
    );

    expect(result.top[0]).toMatchObject({ variant_id: 'top-1', units_sold: 12, revenue: 125.5, stock_on_hand: 4 });
    expect(result.slow.map(row => row.variant_id)).toEqual(['slow-1', 'slow-2']);
    expect(result.slow[0]).toMatchObject({ units_sold: 0, stock_on_hand: 45 });
  });

  it('takes the highest-stock products only from the bottom sales decile, including boundary ties', () => {
    const slowCandidates = [
      product('zero-low-stock', 0, 2),
      product('zero-high-stock', 0, 80),
      product('zero-no-stock', 0, 0),
      ...Array.from({ length: 27 }, (_, index) => product(`seller-${index}`, index + 1, 200 - index)),
    ];
    const result = buildDashboardProductInsights([], slowCandidates, 5);

    expect(result.slow.map(row => row.variant_id)).toEqual(['zero-high-stock', 'zero-low-stock']);
    expect(result.slow.every(row => row.units_sold === 0)).toBe(true);
  });

  it('applies the requested result limit to both groups', () => {
    const topRows = Array.from({ length: 8 }, (_, index) => product(`top-${index}`, 20 - index, index + 1));
    const slowRows = Array.from({ length: 60 }, (_, index) => product(`slow-${index}`, index < 6 ? 0 : index, index + 1));
    const result = buildDashboardProductInsights(topRows, slowRows, 5);

    expect(result.top).toHaveLength(5);
    expect(result.slow).toHaveLength(5);
    expect(result.slow.map(row => row.variant_id)).toEqual(['slow-5', 'slow-4', 'slow-3', 'slow-2', 'slow-1']);
  });
});