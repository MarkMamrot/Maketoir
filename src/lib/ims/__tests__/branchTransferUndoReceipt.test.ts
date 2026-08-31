import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool, mockImsQuery, mockImsExecute } = vi.hoisted(() => ({
  mockGetIMSPool: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: mockImsExecute,
  imsQuery: mockImsQuery,
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn(() => 'tenant_test') }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { BranchTransferUndoConflict, ImsBTRepo } from '../ImsRepository';

beforeEach(() => {
  vi.clearAllMocks();
  mockImsQuery.mockResolvedValue([]);
  mockImsExecute.mockResolvedValue({ affectedRows: 0 });
});

function connectionFor(destinationQty: number, items = [
  { id: 8, transfer_id: 42, variant_id: 'variant-1', qty_sent: 5, qty_received: 4, unit_cost: 12 },
]) {
  const locationQty = new Map<number, number>([[1, 10], [2, destinationQty]]);
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM ims_branch_transfers') && sql.includes('FOR UPDATE')) {
      return [[{ id: 42, status: 'received', from_location_id: 1, to_location_id: 2 }]];
    }
    if (sql.includes('FROM ims_branch_transfer_items') && sql.includes('FOR UPDATE')) {
      return [items];
    }
    if (sql.includes('SELECT location_id, qty_on_hand FROM ims_stock')) return [[
      { location_id: 1, qty_on_hand: 10 },
      { location_id: 2, qty_on_hand: destinationQty },
    ]];
    if (sql.includes('SELECT COALESCE(avg_cost')) return [[{ avg_cost: 12 }]];
    if (sql.includes('SELECT qty_on_hand FROM ims_stock WHERE variant_id=')) {
      return [[{ qty_on_hand: locationQty.get(Number(params[1])) ?? 0 }]];
    }
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('ImsBTRepo.undoReceipt', () => {
  it('reverses destination receipt stock and reopens the transfer as sent', async () => {
    const connection = connectionFor(9);

    await ImsBTRepo.undoReceipt(42, 'biz-1');

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET qty_received = NULL, line_value = qty_sent * unit_cost"),
      [42],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'sent', received_date = NULL"),
      [42, 42, 'biz-1'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'variant-1', 1, 5],
    );
  });

  it('rolls back when destination stock cannot cover the reversal', async () => {
    const connection = connectionFor(3);

    await expect(ImsBTRepo.undoReceipt(42, 'biz-1')).rejects.toThrow(BranchTransferUndoConflict);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'sent'"),
      expect.anything(),
    );
  });

  it('checks the combined received quantity for duplicate variant lines', async () => {
    const connection = connectionFor(5, [
      { id: 8, transfer_id: 42, variant_id: 'variant-1', qty_sent: 3, qty_received: 3, unit_cost: 12 },
      { id: 9, transfer_id: 42, variant_id: 'variant-1', qty_sent: 3, qty_received: 3, unit_cost: 12 },
    ]);

    await expect(ImsBTRepo.undoReceipt(42, 'biz-1')).rejects.toThrow(/6 received units/);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe('ImsBTRepo.update', () => {
  it('rebalances commitments when editing a sent transfer', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, from_location_id')) {
        return [[{ status: 'sent', from_location_id: 1 }]];
      }
      if (sql.includes('SELECT variant_id, qty_sent')) {
        return [[{ variant_id: 'old-variant', qty_sent: 4 }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await ImsBTRepo.update(42, { from_location_id: 3 }, [
      { variant_id: 'new-variant', qty_sent: 6, unit_cost: 10 },
    ], 'biz-1');

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = GREATEST(0, qty_committed - ?)'),
      [4, 'old-variant', 1, 'biz-1'],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('qty_committed = qty_committed + VALUES(qty_committed)'),
      ['biz-1', 'new-variant', 3, 6],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rejects edits after receipt has started', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT status, from_location_id')) {
        return [[{ status: 'partial', from_location_id: 1 }]];
      }
      return [{ affectedRows: 1 }];
    });
    const connection = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute,
    };
    mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });

    await expect(ImsBTRepo.update(42, { notes: 'changed' }, undefined, 'biz-1'))
      .rejects.toThrow('Only draft or sent branch transfers can be edited.');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});