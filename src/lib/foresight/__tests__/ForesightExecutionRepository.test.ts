import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockConnection } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnection: {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
}));

import { ForesightExecutionRepository, type ForesightExecutionRow } from '../repositories/ForesightExecutionRepository';

const execution: ForesightExecutionRow = {
  id: 9, business_id: 'business-1', recommendation_id: 12, approval_id: 4,
  idempotency_key: 'stable-key', state: 'in_progress',
  before_json: { campaigns: [{ budgetId: '456', amountMicros: 100_000_000 }] },
  request_json: { changes: [{ budgetId: '456', proposedAmountMicros: 92_000_000 }] },
  response_json: null, after_json: null, error_text: null,
  compensates_execution_id: null, created_at: '2026-07-29T10:00:00.000Z', completed_at: null,
};

describe('ForesightExecutionRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atomically claims an approved recommendation and records its audit event', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ state: 'approved', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 4 }]])
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 22 }])
      .mockResolvedValueOnce([[execution]]);

    const result = await ForesightExecutionRepository.claim({
      businessId: 'business-1', recommendationId: 12, actorId: 7,
      proposalHash: 'proposal', idempotencyKey: 'stable-key',
      before: execution.before_json, request: execution.request_json,
    });

    expect(result.created).toBe(true);
    expect(result.execution.id).toBe(9);
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'executing'"),
      ['business-1', 12],
    );
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("'google_ads_execution_started'"),
      ['business-1', 12, 'proposal', 7, 'Execution 9'],
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).not.toHaveBeenCalled();
  });

  it('returns the existing idempotent claim without changing recommendation state', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ state: 'executing', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([[execution]]);

    const result = await ForesightExecutionRepository.claim({
      businessId: 'business-1', recommendationId: 12, actorId: 7,
      proposalHash: 'proposal', idempotencyKey: 'stable-key',
      before: execution.before_json, request: execution.request_json,
    });

    expect(result.created).toBe(false);
    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('completes the ledger and recommendation transition in one transaction', async () => {
    const completed = { ...execution, state: 'succeeded', completed_at: '2026-07-29T10:01:00.000Z' };
    mockConnection.execute
      .mockResolvedValueOnce([[execution]])
      .mockResolvedValueOnce([[{ state: 'executing', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 23 }])
      .mockResolvedValueOnce([[completed]]);

    const result = await ForesightExecutionRepository.complete({
      businessId: 'business-1', executionId: 9, actorId: 7, state: 'succeeded',
      response: { operationCount: 1 }, after: { matchesProposed: true }, errorText: null,
    });

    expect(result.state).toBe('succeeded');
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET state = ?, response_json = ?'),
      ['succeeded', JSON.stringify({ operationCount: 1 }), JSON.stringify({ matchesProposed: true }), null, 'business-1', 9],
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back the claim when approval or proposal validation fails', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ state: 'approved', proposal_hash: 'different' }]])
      .mockResolvedValueOnce([[]]);

    await expect(ForesightExecutionRepository.claim({
      businessId: 'business-1', recommendationId: 12, actorId: 7,
      proposalHash: 'proposal', idempotencyKey: 'stable-key', before: {}, request: {},
    })).rejects.toThrow('proposal changed');
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });
});