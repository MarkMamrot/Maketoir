import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetIMSPool } = vi.hoisted(() => ({ mockGetIMSPool: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mockGetIMSPool,
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock('@/services/imsContext', () => ({ getCurrentImsDb: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn() }));
vi.mock('../backorders/domain', () => ({ getCustomerBackorderReadinessConflict: vi.fn() }));

import { ImsCNRepo } from '../ImsRepository';

function connectionFor(operationState?: 'processing' | 'complete') {
  const execute = vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from ims_credit_notes') && normalized.includes('for update')) {
      return [[{
        id: 12,
        business_id: 'biz-1',
        cn_number: 'CN-00012',
        status: 'draft',
        source: 'shopify',
        settlement_method: 'external',
        location_id: 4,
        so_id: null,
        customer_id: null,
        total_amount: 10,
        updated_at: '2026-08-12T09:00:00.000Z',
      }]];
    }
    if (normalized.includes('from ims_inventory_document_operations') && normalized.includes('for update')) {
      return [operationState ? [{
        id: 82,
        request_hash: 'request-hash',
        document_kind: 'customer_credit_note',
        document_id: 12,
        action: 'complete',
        state: operationState,
        response_json: JSON.stringify({ id: 12, status: 'complete' }),
      }] : []];
    }
    if (normalized.startsWith('insert into ims_inventory_document_operations')) {
      return [{ insertId: 82, affectedRows: 1 }];
    }
    if (normalized.includes('from ims_credit_note_items')) return [[]];
    return [{ affectedRows: 1 }];
  });
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute,
  };
  mockGetIMSPool.mockReturnValue({ getConnection: vi.fn(async () => connection) });
  return connection;
}

describe('ImsCNRepo.complete', () => {
  beforeEach(() => vi.clearAllMocks());

  const operationContext = {
    operationKey: 'customer_credit_note:12:complete:revision:r1:request:request-hash',
    requestHash: 'request-hash',
    expectedUpdatedAt: '2026-08-12T09:00:00.000Z',
    actorId: 9,
    actorName: 'Morgan',
  };

  it('replays a completed operation before settlement or stock side effects', async () => {
    const connection = connectionFor('complete');

    await expect(ImsCNRepo.complete(12, 'biz-1', operationContext)).resolves.toBeUndefined();

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_credit_note_items'),
      expect.anything(),
    );
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('store_credit_transactions'),
      expect.anything(),
    );
  });

  it('rolls back a stale revision before settlement or stock side effects', async () => {
    const connection = connectionFor();

    await expect(ImsCNRepo.complete(12, 'biz-1', {
      ...operationContext,
      expectedUpdatedAt: '2026-08-12T08:00:00.000Z',
    })).rejects.toThrow('This document changed after you opened it. Refresh and review the latest values before continuing.');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM ims_credit_note_items'),
      expect.anything(),
    );
  });

  it('completes the operation record in the same document transaction', async () => {
    const connection = connectionFor();

    await ImsCNRepo.complete(12, 'biz-1', operationContext);

    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET status = \'complete\''),
      ['external', null, 12, 'biz-1'],
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'complete'"),
      ['complete', JSON.stringify({ id: 12, status: 'complete' }), JSON.stringify({ status: 'complete', settlementMethod: 'external', storeCreditTransactionId: null }), 82, 'biz-1'],
    );
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });
});