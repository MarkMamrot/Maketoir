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
let quantityOnHand = 20;
let allocationRows: Record<string, unknown>[] = [];

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));

import { fulfilSalesOrderPartial } from '../orderResolution/customerFulfilment';

describe('fulfilSalesOrderPartial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedRequestHash = '';
    firstItemIsStock = 1;
    quantityOnHand = 20;
    allocationRows = [];
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
        return [[{ qty_on_hand: quantityOnHand, qty_committed: 12, avg_cost: 4.5 }]];
      }
      if (sql.includes('FROM ims_stock_allocations')) return [allocationRows];
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
      allocationFulfilments: [],
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

  it('leaves a fully shipped order in progress until completion is explicit', async () => {
    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1',
      soId: 42,
      operationKey: 'shipment-42-full',
      shipmentQuantities: [{ itemId: 10, quantity: 10 }, { itemId: 11, quantity: 2 }],
    });

    expect(result.status).toBe('partially_fulfilled');
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET status = ?'),
      ['partially_fulfilled', 'partially_fulfilled', 42, 'biz-1'],
    );
  });

  it('finalizes a fully shipped Shopify order when requested', async () => {
    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1',
      soId: 42,
      operationKey: 'shopify-fulfillment-42',
      shipmentQuantities: [{ itemId: 10, quantity: 10 }, { itemId: 11, quantity: 2 }],
      finalizeWhenComplete: true,
    });

    expect(result.status).toBe('fulfilled');
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET status = ?'),
      ['fulfilled', 'fulfilled', 42, 'biz-1'],
    );
  });

  it('consumes received protection before general stock in the same fulfilment transaction', async () => {
    allocationRows = [{
      id: 71, qty_allocated: 5, qty_received_assigned: 3, qty_fulfilled: 0, state: 'active',
    }];

    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-allocated',
      shipmentQuantities: [{ itemId: 10, quantity: 4 }],
    });

    expect(result.allocationFulfilments).toEqual([{
      soItemId: 10,
      consumedQuantity: 3,
      releasedQuantity: 0,
      fulfilledAllocationIds: [],
      releasedAllocationIds: [],
    }]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_fulfilled = ?'),
      [3, 71, 'biz-1'],
    );
  });

  it('automatically releases unreceived protection when the sales order line is fully shipped', async () => {
    allocationRows = [{
      id: 72, qty_allocated: 5, qty_received_assigned: 2, qty_fulfilled: 0, state: 'active',
    }];

    const result = await fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-final-allocation',
      shipmentQuantities: [{ itemId: 10, quantity: 10 }],
    });

    expect(result.allocationFulfilments).toEqual([{
      soItemId: 10,
      consumedQuantity: 2,
      releasedQuantity: 3,
      fulfilledAllocationIds: [],
      releasedAllocationIds: [72],
    }]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("state = 'released'"),
      [2, expect.stringContaining('shipment-42-final-allocation'), 72, 'biz-1'],
    );
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

  it('returns a structured warning before allowing stock to go negative', async () => {
    quantityOnHand = 2;

    await expect(fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-short',
      shipmentQuantities: [{ itemId: 10, quantity: 3 }],
    })).rejects.toMatchObject({
      code: 'STOCK_SHORTFALL',
      shortfalls: [{ itemId: 10, quantityOnHand: 2, requestedQuantity: 3, resultingQuantityOnHand: -1 }],
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('allows negative stock only after an explicit override', async () => {
    quantityOnHand = 2;

    await fulfilSalesOrderPartial({
      businessId: 'biz-1', soId: 42, operationKey: 'shipment-42-short-confirmed',
      shipmentQuantities: [{ itemId: 10, quantity: 3 }],
      allowNegativeStock: true,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SET qty_on_hand = ?'),
      [-1, 3, 'variant-1', 4],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});