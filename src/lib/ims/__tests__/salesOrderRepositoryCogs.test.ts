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

  it('reads the complete order on a caller-owned connection without pool queries or lazy DDL', async () => {
    const implementation = mockImsQuery.getMockImplementation()!;
    const connection = {
      execute: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => [await implementation(sql, params), []]),
    };

    const order = await ImsSORepo.get(42, 'biz-1', connection);

    expect(order?.id).toBe(42);
    expect(order?.items?.[0].catalogue_cost_estimate).toBe(1.38);
    expect(order?.payments).toEqual([]);
    expect(connection.execute).toHaveBeenCalledTimes(3);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE so.id = ? AND so.business_id = ?'),
      [42, 'biz-1'],
    );
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockImsExecute).not.toHaveBeenCalled();
  });

  it('keeps the legacy payments fallback on the caller-owned connection', async () => {
    const implementation = mockImsQuery.getMockImplementation()!;
    const connection = {
      execute: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.startsWith('SELECT * FROM ims_sales_order_payments')) throw new Error('Legacy payment table unavailable');
        return [await implementation(sql, params), []];
      }),
    };

    const order = await ImsSORepo.get(42, 'biz-1', connection);

    expect(order?.id).toBe(42);
    expect(order?.items).toHaveLength(1);
    expect(connection.execute).toHaveBeenCalledTimes(4);
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockImsExecute).not.toHaveBeenCalled();
  });
});