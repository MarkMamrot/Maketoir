import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIMSPool: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getIMSPool }));
vi.mock('../inventoryDocumentOperations', async importOriginal => {
  const actual = await importOriginal<typeof import('../inventoryDocumentOperations')>();
  return {
    ...actual,
    claimInventoryDocumentOperation: mocks.claim,
    completeInventoryDocumentOperation: mocks.complete,
  };
});

import { executeCreditNoteStatusCommand } from '../creditNoteStatusCommands';

function createConnection(results: any[]) {
  const connection = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(),
  };
  for (const result of results) connection.execute.mockResolvedValueOnce(result);
  mocks.getIMSPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
  return connection;
}

const context = {
  operationKey: 'customer_credit_note:7:cancel:revision:r1:request:abc',
  requestHash: 'a'.repeat(64),
  expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
  actorId: 3,
  actorName: 'Alex',
};

describe('credit note status commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ operationId: 81, replayed: false, response: null });
    mocks.complete.mockResolvedValue(undefined);
  });

  it('cancels a draft customer credit note and completes the operation in one transaction', async () => {
    const connection = createConnection([
      [[{ id: 7, status: 'draft', source: 'manual', updated_at: new Date('2026-08-12T09:00:00.000Z') }]],
      [{ affectedRows: 1 }],
      [[{ updated_at: new Date('2026-08-12T09:01:00.000Z') }]],
    ]);

    await expect(executeCreditNoteStatusCommand({
      businessId: 'biz-1', documentKind: 'customer_credit_note', documentId: 7, action: 'cancel', context,
    })).resolves.toEqual({ id: 7, status: 'cancelled', updatedAt: '2026-08-12T09:01:00.000Z', replayed: false });

    expect(connection.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE ims_credit_notes SET status = ?'),
      ['cancelled', 7, 'biz-1'],
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      connection, 'biz-1', 81, 'cancelled', expect.objectContaining({ status: 'cancelled' }), { status: 'cancelled' },
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('returns a completed replay before revision and lifecycle checks', async () => {
    const connection = createConnection([
      [[{ id: 7, status: 'cancelled', source: 'manual', updated_at: new Date('2026-08-12T10:00:00.000Z') }]],
    ]);
    mocks.claim.mockResolvedValue({
      operationId: 81,
      replayed: true,
      response: { id: 7, status: 'cancelled', updatedAt: '2026-08-12T09:01:00.000Z', replayed: false },
    });

    await expect(executeCreditNoteStatusCommand({
      businessId: 'biz-1', documentKind: 'customer_credit_note', documentId: 7, action: 'cancel', context,
    })).resolves.toMatchObject({ status: 'cancelled', replayed: true });
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back a stale revision before changing status', async () => {
    const connection = createConnection([
      [[{ id: 7, status: 'draft', source: 'manual', updated_at: new Date('2026-08-12T10:00:00.000Z') }]],
    ]);

    await expect(executeCreditNoteStatusCommand({
      businessId: 'biz-1', documentKind: 'customer_credit_note', documentId: 7, action: 'cancel', context,
    })).rejects.toThrow('document changed after you opened it');
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('rejects invalid transitions without updating the supplier note', async () => {
    const connection = createConnection([
      [[{ id: 9, status: 'complete', updated_at: new Date('2026-08-12T09:00:00.000Z') }]],
    ]);

    await expect(executeCreditNoteStatusCommand({
      businessId: 'biz-1', documentKind: 'supplier_credit_note', documentId: 9, action: 'cancel', context,
    })).rejects.toThrow('cannot perform cancel from complete');
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});