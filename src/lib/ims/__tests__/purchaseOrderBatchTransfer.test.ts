import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const transferInTransaction = vi.hoisted(() => vi.fn());
const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute };

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));
vi.mock('../orderTransfers/purchaseOrderTransfer', () => ({
  PurchaseOrderTransferConflict: class PurchaseOrderTransferConflict extends Error {},
  transferPurchaseOrderItemsInTransaction: transferInTransaction,
}));

import { transferPurchaseOrderItemsBatch } from '../orderTransfers/purchaseOrderBatchTransfer';

const batchInput = {
  businessId: 'biz-1', targetOrderId: 10, expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
  operationKey: 'po-batch-1', actorId: 8, actorName: 'Alex',
  sources: [{ sourceOrderId: 20, expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z', lines: [{
    sourceItemId: 201, quantity: 3, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }],
  }] }, { sourceOrderId: 30, expectedSourceUpdatedAt: '2026-09-02T00:00:00.000Z', lines: [{
    sourceItemId: 301, quantity: 4, allocations: [],
  }] }],
};

describe('transferPurchaseOrderItemsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_purchase_orders')) return [[
        { id: 10, po_number: 'PO-10', status: 'confirmed', updated_at: '2026-09-03T00:00:00.000Z' },
        { id: 20, po_number: 'PO-20', status: 'backordered', updated_at: '2026-09-01T00:00:00.000Z' },
        { id: 30, po_number: 'PO-30', status: 'partially_received', updated_at: '2026-09-02T00:00:00.000Z' },
      ]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: 900 }];
      return [{ affectedRows: 1 }];
    });
    transferInTransaction.mockImplementation(async (_connection, input) => ({
      replayed: false, sourceOrderId: input.sourceOrderId, targetOrderId: 10, targetOrderNumber: 'PO-10',
      sourceStatus: 'cancelled', targetStatus: 'confirmed', movedLines: [],
      variantIds: input.sourceOrderId === 20 ? ['variant-1'] : ['variant-2', 'variant-1'],
    }));
  });

  it('moves exact customer promises through one transaction and commits once', async () => {
    const result = await transferPurchaseOrderItemsBatch(batchInput);

    expect(result).toMatchObject({ targetOrderId: 10, sourceOrderIds: [20, 30], variantIds: ['variant-1', 'variant-2'] });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('ORDER BY id FOR UPDATE'), ['biz-1', 10, 20, 30]);
    expect(transferInTransaction).toHaveBeenNthCalledWith(1, connection, expect.objectContaining({
      sourceOrderId: 20, targetOrderId: 10, operationKey: 'po-batch-1:source:20',
      lines: [{ sourceItemId: 201, quantity: 3, allocations: [{ allocationId: 501, revision: 2, quantity: 2 }] }],
    }));
    expect(transferInTransaction).toHaveBeenNthCalledWith(2, connection, expect.objectContaining({ sourceOrderId: 30 }));
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('rolls back every source when one promise-aware move fails', async () => {
    transferInTransaction.mockResolvedValueOnce({ variantIds: ['variant-1'] }).mockRejectedValueOnce(new Error('Promise changed.'));

    await expect(transferPurchaseOrderItemsBatch(batchInput)).rejects.toThrow('Promise changed.');

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
