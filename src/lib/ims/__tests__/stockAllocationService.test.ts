import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute,
};

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({
    getConnection: vi.fn(async () => connection),
    execute,
  })),
}));

import {
  assignReceiptToStockAllocations,
  buildStockAllocationRequestHash,
  createStockAllocation,
  StockAllocationConflict,
} from '../stockAllocation/service';

const input = {
  businessId: 'biz-1',
  operationKey: 'allocate-1',
  soItemId: 11,
  poItemId: 21,
  quantity: 4,
  promisedDate: '2026-09-10',
  actorId: 7,
  actorName: 'Alex',
};

function mockNewAllocation(options?: { soAllocated?: number; poAllocated?: number }) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM ims_sales_order_items')) return [[{
      id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
      business_id: 'biz-1', location_id: 4, status: 'confirmed',
    }]];
    if (sql.includes('FROM ims_purchase_order_items')) return [[{
      id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
      business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
    }]];
    if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
    if (sql.includes('WHERE business_id = ? AND so_item_id')) {
      return [options?.soAllocated ? [{ qty_allocated: options.soAllocated, qty_fulfilled: 0 }] : []];
    }
    if (sql.includes('WHERE business_id = ? AND po_item_id')) {
      return [options?.poAllocated ? [{ qty_allocated: options.poAllocated, qty_received_assigned: 0 }] : []];
    }
    if (sql.includes('INSERT INTO ims_stock_allocation_operations')) return [{ insertId: 31 }];
    if (sql.includes('INSERT INTO ims_stock_allocations')) return [{ insertId: 41 }];
    return [{ affectedRows: 1 }];
  });
}

describe('stock allocation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one protected allocation and completes its operation atomically', async () => {
    mockNewAllocation();

    await expect(createStockAllocation(input)).resolves.toEqual({ allocationId: 41, replayed: false });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_stock_allocations'),
      ['biz-1', 1, 11, 2, 21, 'v-1', 4, 4, '2026-09-08', '2026-09-10', 'confirmed', 0, null, 7, 'Alex'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('replays a completed matching request without inserting another allocation', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed',
      }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
      }]];
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[{
        request_hash: buildStockAllocationRequestHash(input),
        state: 'complete',
        response_json: { allocationId: 41 },
      }]];
      return [[]];
    });

    await expect(createStockAllocation(input)).resolves.toEqual({ allocationId: 41, replayed: true });
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock_allocations'))).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects changed payload reuse before capacity or allocation writes', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[{
        id: 11, so_id: 1, variant_id: 'v-1', qty_ordered: 10, qty_fulfilled: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed',
      }]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[{
        id: 21, po_id: 2, variant_id: 'v-1', qty_ordered: 12, qty_received: 2,
        business_id: 'biz-1', location_id: 4, status: 'confirmed', expected_date: '2026-09-08',
      }]];
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[{
        request_hash: buildStockAllocationRequestHash({ ...input, quantity: 3 }),
        state: 'complete', response_json: { allocationId: 40 },
      }]];
      return [[]];
    });

    await expect(createStockAllocation(input)).rejects.toBeInstanceOf(StockAllocationConflict);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ims_stock_allocations'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('rejects demand or supply over-allocation under the locked rows', async () => {
    mockNewAllocation({ soAllocated: 5 });
    await expect(createStockAllocation(input)).rejects.toThrow('sales order line quantity');

    vi.clearAllMocks();
    mockNewAllocation({ poAllocated: 7 });
    await expect(createStockAllocation(input)).rejects.toThrow('purchase order quantity');
  });

  it('assigns receipt quantities to allocations in locked priority order', async () => {
    const receiptExecute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ims_stock_allocations')) return [[
        { id: 1, so_id: 10, so_item_id: 101, qty_allocated: 3, qty_received_assigned: 1 },
        { id: 2, so_id: 20, so_item_id: 201, qty_allocated: 4, qty_received_assigned: 0 },
      ]];
      return [{ affectedRows: 1 }];
    });

    await expect(assignReceiptToStockAllocations({ execute: receiptExecute }, {
      businessId: 'biz-1', poItemId: 21, receivedQuantity: 5,
    })).resolves.toEqual([
      { allocationId: 1, soId: 10, soItemId: 101, quantity: 2, ready: true },
      { allocationId: 2, soId: 20, soItemId: 201, quantity: 3, ready: false },
    ]);
    expect(receiptExecute).toHaveBeenNthCalledWith(2, expect.stringContaining('qty_received_assigned = qty_received_assigned + ?'), [2, 1, 'biz-1']);
    expect(receiptExecute).toHaveBeenNthCalledWith(3, expect.stringContaining('qty_received_assigned = qty_received_assigned + ?'), [3, 2, 'biz-1']);
  });
});