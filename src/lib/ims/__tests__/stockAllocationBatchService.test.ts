import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection, execute, getConnection } = vi.hoisted(() => {
  const execute = vi.fn();
  const connection = {
    execute,
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return { connection, execute, getConnection: vi.fn(async () => connection) };
});

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection }) }));

import { createStockAllocationBatch } from '../stockAllocation/batchService';

describe('createStockAllocationBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let insertId = 40;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_order_items')) return [[
        { id: 11, so_id: 10, variant_id: 'variant-1', qty_ordered: 4, qty_fulfilled: 0, location_id: 4, status: 'confirmed', so_type: 'b2b' },
        { id: 13, so_id: 12, variant_id: 'variant-1', qty_ordered: 4, qty_fulfilled: 0, location_id: 4, status: 'confirmed', so_type: 'b2b' },
      ]];
      if (sql.includes('FROM ims_purchase_order_items')) return [[
        { id: 21, po_id: 20, variant_id: 'variant-1', qty_ordered: 6, qty_received: 0, location_id: 4, status: 'confirmed', expected_date: '2026-10-08' },
      ]];
      if (sql.includes('FROM ims_stock_allocations')) return [[]];
      if (sql.includes('FROM ims_stock_allocation_operations')) return [[]];
      if (sql.includes('INSERT INTO ims_stock_allocation_operations')) return [{ insertId: ++insertId }];
      if (sql.includes('INSERT INTO ims_stock_allocations')) return [{ insertId: ++insertId }];
      return [{ affectedRows: 1 }];
    });
  });

  it('applies every reviewed suggestion in one transaction', async () => {
    const result = await createStockAllocationBatch({
      businessId: 'biz-1', operationKey: 'review-1',
      allocations: [
        { soItemId: 13, poItemId: 21, quantity: 4, priority: 1 },
        { soItemId: 11, poItemId: 21, quantity: 2, priority: 2 },
      ],
    });

    expect(result.allocationIds).toHaveLength(2);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(execute.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO ims_stock_allocations'))).toHaveLength(2);
  });

  it('rolls back the whole review when combined suggestions exceed free supply', async () => {
    await expect(createStockAllocationBatch({
      businessId: 'biz-1', operationKey: 'review-2',
      allocations: [
        { soItemId: 13, poItemId: 21, quantity: 4, priority: 1 },
        { soItemId: 11, poItemId: 21, quantity: 3, priority: 2 },
      ],
    })).rejects.toThrow('incoming supply still free');

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});