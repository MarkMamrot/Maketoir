import { describe, expect, it } from 'vitest';
import { normaliseDashboardSalesRows } from './route';

describe('normaliseDashboardSalesRows', () => {
  it('coerces totals and gross profit values to numbers', () => {
    const rows = normaliseDashboardSalesRows([
      { channel: 'pos', location_name: 'Main', total: '123.45', gross_profit: '45.67', order_count: '3' },
      { channel: 'online', location_name: 'Web', total: 20, gross_profit: null, order_count: 1 },
    ]);

    expect(rows).toEqual([
      { channel: 'pos', location_name: 'Main', total: 123.45, gross_profit: 45.67, order_count: 3 },
      { channel: 'online', location_name: 'Web', total: 20, gross_profit: 0, order_count: 1 },
    ]);
  });
});
