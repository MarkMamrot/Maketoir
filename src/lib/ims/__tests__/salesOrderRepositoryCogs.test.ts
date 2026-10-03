import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(),
  imsQuery: mockImsQuery,
  imsExecute: mockImsExecute,
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));

import { ImsSORepo } from '../ImsRepository';

describe('ImsSORepo.get COGS fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT so.*')) return [{ id: 42, so_number: 'SO-TEST', business_id: 'biz-1' }];
      if (sql.includes('FROM ims_sales_order_payments')) return [];
      if (sql.includes('SHOW COLUMNS FROM ims_product_variants')) return [{ Field: 'avg_cost' }];
      if (sql.includes('FROM ims_sales_order_items i')) return [{
        id: 10,
        qty_ordered: 4,
        qty_fulfilled: 4,
        unit_cost: 1.38,
        captured_unit_cost: 0,
        catalogue_cost_estimate: 1.38,
        catalogue_cost_source: 'average_cost',
        is_stock_item: 1,
      }];
      return [];
    });
  });

  it('returns persisted shipment cost separately from current catalogue estimate', async () => {
    const order = await ImsSORepo.get(42, 'biz-1');

    expect(order?.items?.[0]).toMatchObject({
      unit_cost: 1.38,
      captured_unit_cost: 0,
      catalogue_cost_estimate: 1.38,
      catalogue_cost_source: 'average_cost',
      is_stock_item: 1,
    });
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining('i.unit_cost AS captured_unit_cost'),
      [42],
    );
    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining('AS catalogue_cost_estimate'),
      [42],
    );
  });
});