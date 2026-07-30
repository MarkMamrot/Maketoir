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
      expect.stringContaining("VALUES (?, ?, 'approved', 'executing', ?, ?, ?, ?)"),
      ['business-1', 12, 'proposal', 7, 'google_ads_execution_started', 'Execution 9'],
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).not.toHaveBeenCalled();
  });

  it('records Meta execution audit events with the correct platform', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ state: 'approved', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: 4 }]])
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 22 }])
      .mockResolvedValueOnce([[execution]]);

    await ForesightExecutionRepository.claim({
      businessId: 'business-1', recommendationId: 12, actorId: 7,
      proposalHash: 'proposal', idempotencyKey: 'stable-key',
      before: execution.before_json, request: execution.request_json, platform: 'meta_ads',
    });

    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, 'approved', 'executing', ?, ?, ?, ?)"),
      ['business-1', 12, 'proposal', 7, 'meta_ads_execution_started', 'Execution 9'],
    );
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

  it('claims one linked compensation without changing succeeded recommendation state', async () => {
    const original = { ...execution, state: 'succeeded' as const, completed_at: '2026-07-29T10:01:00.000Z' };
    const compensation = {
      ...execution, id: 10, idempotency_key: 'rollback-key',
      compensates_execution_id: 9,
    };
    mockConnection.execute
      .mockResolvedValueOnce([[original]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ state: 'succeeded', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([{ insertId: 24 }])
      .mockResolvedValueOnce([[compensation]]);

    const result = await ForesightExecutionRepository.claimCompensation({
      businessId: 'business-1', recommendationId: 12, originalExecutionId: 9,
      actorId: 7, proposalHash: 'proposal', idempotencyKey: 'rollback-key',
      before: { campaigns: [] }, request: { changes: [] },
    });

    expect(result.created).toBe(true);
    expect(result.execution.compensates_execution_id).toBe(9);
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('compensates_execution_id'),
      ['business-1', 12, 4, 'rollback-key', JSON.stringify({ campaigns: [] }), JSON.stringify({ changes: [] }), 9],
    );
    expect(mockConnection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'compensating'"),
      expect.anything(),
    );
  });

  it('marks the recommendation compensated only after verified restoration', async () => {
    const compensation = { ...execution, id: 10, compensates_execution_id: 9 };
    const completed = { ...compensation, state: 'succeeded', completed_at: '2026-07-29T10:05:00.000Z' };
    mockConnection.execute
      .mockResolvedValueOnce([[compensation]])
      .mockResolvedValueOnce([[{ state: 'succeeded', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 25 }])
      .mockResolvedValueOnce([[completed]]);

    const result = await ForesightExecutionRepository.completeCompensation({
      businessId: 'business-1', executionId: 10, actorId: 7, state: 'succeeded',
      response: { operationCount: 1 }, after: { matchesRestored: true }, errorText: null,
    });

    expect(result.state).toBe('succeeded');
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'compensated'"),
      ['business-1', 12],
    );
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_recommendation_events'),
      ['business-1', 12, 'compensated', 'proposal', 7, 'google_ads_rollback_succeeded', 'Compensation 10 for execution 9'],
    );
  });

  it('records failed compensation without mislabeling the original recommendation', async () => {
    const compensation = { ...execution, id: 10, compensates_execution_id: 9 };
    const failed = { ...compensation, state: 'failed', error_text: 'Live read-back diverged.' };
    mockConnection.execute
      .mockResolvedValueOnce([[compensation]])
      .mockResolvedValueOnce([[{ state: 'succeeded', proposal_hash: 'proposal' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 26 }])
      .mockResolvedValueOnce([[failed]]);

    await ForesightExecutionRepository.completeCompensation({
      businessId: 'business-1', executionId: 10, actorId: 7, state: 'failed',
      response: null, after: null, errorText: 'Live read-back diverged.',
    });

    expect(mockConnection.execute).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE foresight_recommendations SET state'),
      expect.anything(),
    );
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_recommendation_events'),
      ['business-1', 12, 'succeeded', 'proposal', 7, 'google_ads_rollback_failed', 'Live read-back diverged.'],
    );
  });
});