import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute,
};

let storedRequestHash = '';
let firstItemIsStock = 1;

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));

import { fulfilSalesOrderPartial } from '../orderResolution/customerFulfilment';

describe('fulfilSalesOrderPartial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedRequestHash = '';
    firstItemIsStock = 1;
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT IGNORE INTO ims_so_fulfilment_operations')) {
        storedRequestHash = String(params?.[2] ?? '');
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM ims_so_fulfilment_operations')) {
        return [[{ so_id: 42, request_hash: storedRequestHash, status: 'processing', response_json: null }]];
      }
      if (sql.includes('FROM ims_sales_orders')) {
        return [[{
          id: 42, business_id: 'biz-1', status: 'confirmed', so_type: 'b2b', location_id: 4, is_historical: 0,
        }]];
      }
      if (sql.includes('FROM ims_sales_order_items')) {
        return [[
          { id: 10, variant_id: 'variant-1', qty_ordered: 10, qty_fulfilled: 0, unit_cost: null, is_stock_item: firstItemIsStock },
          { id: 11, variant_id: 'variant-2', qty_ordered: 2, qty_fulfilled: 0, unit_cost: null },
        ]];
      }
      if (sql.includes('FROM ims_stock s')) {
        return [[{ qty_on_hand: 20, qty_committed: 12, avg_cost: 4.5 }]];
      }
      return [{ affectedRows: 1 }];
    });
  });

  it('ships only requested deltas and leaves the order partially fulfilled', async () => {
    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1',
      soId: 42,
      operationKey: 'shipment-42-1',
      shipmentQuantities: [{ itemId: 10, quantity: 7 }, { itemId: 11, quantity: 0 }],
    });

    expect(result).toEqual({
      soId: 42,
      status: 'partially_fulfilled',
      operationKey: 'shipment-42-1',
      fulfilledVariantIds: ['variant-1'],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed - ?'),
      [13, 7, 'variant-1', 4],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'complete'"),
      [expect.any(String), 'biz-1', 'shipment-42-1'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('returns the stored response without moving stock on an exact retry', async () => {
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT IGNORE INTO ims_so_fulfilment_operations')) {
        storedRequestHash = String(params?.[2] ?? '');
        return [{ affectedRows: 0 }];
      }
      if (sql.includes('FROM ims_so_fulfilment_operations')) {
        return [[{
          so_id: 42,
          request_hash: storedRequestHash,
          status: 'complete',
          response_json: JSON.stringify({
            soId: 42,
            status: 'partially_fulfilled',
            operationKey: 'shipment-42-1',
            fulfilledVariantIds: ['variant-1'],
          }),
        }]];
      }
      return [{ affectedRows: 1 }];
    });

    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-1',
      shipmentQuantities: [{ itemId: 10, quantity: 7 }],
    });

    expect(result.status).toBe('partially_fulfilled');
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('UPDATE ims_stock'))).toBe(false);
  });

  it('fulfils a non-stock line without stock or movement writes', async () => {
    firstItemIsStock = 0;

    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-service',
      shipmentQuantities: [{ itemId: 10, quantity: 10 }],
    });

    expect(result.fulfilledVariantIds).toEqual([]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_fulfilled = ?, unit_cost = 0'),
      [10, 10, 42],
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('FROM ims_stock s'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock_movements'))).toBe(false);
  });

  it('rejects an operation key reused with different shipment quantities', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_so_fulfilment_operations')) {
        return [[{ so_id: 42, request_hash: 'different-request', status: 'complete', response_json: '{}' }]];
      }
      return [{ affectedRows: 0 }];
    });

    await expect(fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-1',
      shipmentQuantities: [{ itemId: 10, quantity: 6 }],
    })).rejects.toThrow('different shipment quantities');
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('rolls back when a shipment exceeds its outstanding quantity', async () => {
    await expect(fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-too-many',
      shipmentQuantities: [{ itemId: 10, quantity: 11 }],
    })).rejects.toThrow('exceeds the outstanding quantity');
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});