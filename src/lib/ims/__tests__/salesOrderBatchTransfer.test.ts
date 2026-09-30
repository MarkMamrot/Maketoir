import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const transferInTransaction = vi.hoisted(() => vi.fn());
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  execute,
};

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: vi.fn(() => ({ getConnection: vi.fn(async () => connection) })),
}));
vi.mock('../orderTransfers/salesOrderTransfer', () => ({
  SalesOrderTransferConflict: class SalesOrderTransferConflict extends Error {},
  transferSalesOrderItemsInTransaction: transferInTransaction,
}));

import { transferSalesOrderItemsBatch } from '../orderTransfers/salesOrderBatchTransfer';

const sourceOne = {
  sourceOrderId: 20,
  expectedSourceUpdatedAt: '2026-09-01T00:00:00.000Z',
  lines: [{ sourceItemId: 201, quantity: 2, allocatedIncomingQuantity: 1 }],
};
const sourceTwo = {
  sourceOrderId: 30,
  expectedSourceUpdatedAt: '2026-09-02T00:00:00.000Z',
  lines: [{ sourceItemId: 301, quantity: 3, allocatedIncomingQuantity: 0 }],
};

function input() {
  return {
    businessId: 'biz-1',
    targetOrderId: 10,
    expectedTargetUpdatedAt: '2026-09-03T00:00:00.000Z',
    sources: [sourceTwo, sourceOne],
    operationKey: 'batch-move-1',
    actorId: 7,
    actorName: 'Alex',
  };
}

describe('transferSalesOrderItemsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let insertId = 900;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[]];
      if (sql.includes('FROM ims_sales_orders')) return [[
        { id: 10, so_number: 'SO-10', status: 'confirmed', updated_at: '2026-09-03T00:00:00.000Z' },
        { id: 20, so_number: 'SO-20', status: 'backordered', updated_at: '2026-09-01T00:00:00.000Z' },
        { id: 30, so_number: 'SO-30', status: 'confirmed', updated_at: '2026-09-02T00:00:00.000Z' },
      ]];
      if (sql.includes('INSERT INTO ims_order_amendment_operations')) return [{ insertId: insertId++ }];
      return [{ affectedRows: 1 }];
    });
    transferInTransaction.mockImplementation(async (_connection, transferInput) => ({
      replayed: false,
      sourceOrderId: transferInput.sourceOrderId,
      targetOrderId: 10,
      targetOrderNumber: 'SO-10',
      sourceStatus: 'cancelled',
      targetStatus: 'confirmed',
      movedLines: [],
      variantIds: transferInput.sourceOrderId === 20 ? ['variant-1'] : ['variant-2', 'variant-1'],
    }));
  });

  it('moves every source through one caller-owned transaction and commits once', async () => {
    const result = await transferSalesOrderItemsBatch(input());

    expect(result).toMatchObject({
      replayed: false,
      targetOrderId: 10,
      targetOrderNumber: 'SO-10',
      sourceOrderIds: [20, 30],
      variantIds: ['variant-1', 'variant-2'],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY id FOR UPDATE'),
      ['biz-1', 10, 20, 30],
    );
    expect(transferInTransaction).toHaveBeenNthCalledWith(1, connection, expect.objectContaining({
      sourceOrderId: 20,
      targetOrderId: 10,
      operationKey: 'batch-move-1:source:20',
    }));
    expect(transferInTransaction).toHaveBeenNthCalledWith(2, connection, expect.objectContaining({
      sourceOrderId: 30,
      targetOrderId: 10,
      operationKey: 'batch-move-1:source:30',
    }));
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back every source when any transfer fails', async () => {
    transferInTransaction
      .mockResolvedValueOnce({ variantIds: ['variant-1'] })
      .mockRejectedValueOnce(new Error('Source SO-30 changed.'));

    await expect(transferSalesOrderItemsBatch(input())).rejects.toThrow('Source SO-30 changed.');

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('replays the completed batch without applying source transfers again', async () => {
    const replayResult = {
      replayed: false,
      targetOrderId: 10,
      targetOrderNumber: 'SO-10',
      sourceOrderIds: [20, 30],
      transfers: [],
      variantIds: ['variant-1'],
    };
    const firstRun = await transferSalesOrderItemsBatch(input());
    const insertCall = execute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ims_order_amendment_operations'))!;
    const requestHash = String(insertCall[1][2]);
    const completedJson = execute.mock.calls
      .filter(([sql]) => String(sql).includes("SET state = 'complete'"))
      .map(([, params]) => JSON.parse(String(params[0])))[0];
    expect(firstRun.targetOrderId).toBe(10);

    vi.clearAllMocks();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_order_amendment_operations')) return [[{
        request_hash: requestHash,
        state: 'complete',
        after_header_json: JSON.stringify({ transferBatchResult: replayResult }),
      }]];
      return [{ affectedRows: 1 }];
    });

    const replay = await transferSalesOrderItemsBatch(input());

    expect(completedJson.transferBatchResult.targetOrderId).toBe(10);
    expect(replay).toEqual({ ...replayResult, replayed: true });
    expect(transferInTransaction).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });
});
