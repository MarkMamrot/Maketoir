import { describe, expect, it } from 'vitest';
import { dashboardSalesBounds, normaliseDashboardBrandRows, normaliseDashboardSalesRows } from './route';

describe('normaliseDashboardSalesRows', () => {
  it('coerces totals and gross profit values to numbers', () => {
    const rows = normaliseDashboardSalesRows([
      { channel: 'pos', location_name: 'Main', total: '123.45', gross_profit: '45.67', order_count: '3' },
      { channel: 'online', location_name: 'Web', total: 20, gross_profit: null, order_count: 1 },
    ]);

    expect(rows).toEqual([
      { channel: 'pos', location_name: 'Main', total: 123.45, tax: 0, cogs: 0, gross_profit: 45.67, order_count: 3 },
      { channel: 'online', location_name: 'Web', total: 20, tax: 0, cogs: 0, gross_profit: 0, order_count: 1 },
    ]);
  });
});

describe('dashboardSalesBounds', () => {
  it('returns a bounded business-local interval for yesterday', () => {
    expect(dashboardSalesBounds(1, 'Australia/Brisbane', true, new Date('2026-07-30T03:00:00Z'))).toEqual({
      from: '2026-07-29 00:00:00',
      to: '2026-07-30 00:00:00',
    });
  });
});

describe('normaliseDashboardBrandRows', () => {
  it('coerces brand sales totals to numbers', () => {
    expect(normaliseDashboardBrandRows([{ name: 'Brand A', sales: '42.50' }])).toEqual([{ name: 'Brand A', sales: 42.5 }]);
  });
});
