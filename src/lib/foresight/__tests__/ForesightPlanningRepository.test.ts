import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery, mockConnection } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
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
  execute: mockExecute,
  query: mockQuery,
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
}));

import {
  ForesightPlanningRepository,
  PlanningThreadConflictError,
} from '../repositories/ForesightPlanningRepository';

const plan = {
  schemaVersion: 1,
  title: 'Growth plan', objective: 'Grow contribution.', planningHorizon: '90 days',
  strategyVersion: 1, recommendationIds: [20], humanGoals: ['Growth'], targetAudiences: ['Collectors'],
  constraints: ['POAS above 3'], citations: [{ factId: 'fact-1', source: 'Foresight', authority: 'authoritative', observedFrom: '2026-07-01', observedThrough: '2026-07-31' }],
  statements: [{ kind: 'fact', text: 'Contribution is healthy.', citationFactIds: ['fact-1'] }],
  questions: [], options: [], selectedOptionId: null, actions: [],
  successMetrics: ['Contribution'], guardrails: ['Human approval'],
  monitoringPlan: { reviewDate: null, stopConditions: [] }, confidence: 0.8,
};

describe('ForesightPlanningRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates tenant-scoped planning threads in discovering state', async () => {
    mockExecute.mockResolvedValue({ insertId: 12 });

    await expect(ForesightPlanningRepository.createThread('business-1', {
      threadType: 'strategy', title: 'Marketing strategy', createdBy: 7,
    })).resolves.toBe(12);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, 'discovering'"),
      ['business-1', 'strategy', 'Marketing strategy', null, 7],
    );
  });

  it('appends messages only through a matching tenant thread', async () => {
    mockExecute.mockResolvedValue({ insertId: 21, affectedRows: 1 });

    await expect(ForesightPlanningRepository.appendMessage('business-1', 12, {
      actorType: 'human', actorUserId: 7, content: 'Prioritise retention.',
    })).resolves.toBe(21);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \?, thread\.id[\s\S]*thread\.business_id = \? AND thread\.id = \?/),
      expect.arrayContaining(['business-1', 'human', 7, 'Prioritise retention.', 'business-1', 12]),
    );
  });

  it('creates immutable plan versions and advances the locked thread revision', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ revision: 3 }]])
      .mockResolvedValueOnce([[{ id: 40, version: 2 }]])
      .mockResolvedValueOnce([{ insertId: 41 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await ForesightPlanningRepository.createPlanVersion('business-1', 12, 3, {
      plan, state: 'ready_for_validation', authoredBy: 7, changeReason: 'Human goals clarified.',
    });

    expect(result).toMatchObject({ id: 41, version: 3, threadRevision: 4 });
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.markdown).toContain('# Growth plan');
    expect(mockConnection.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('AND revision = ?'),
      ['ready_for_validation', 4, 'business-1', 12, 3],
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('rejects stale plan edits and rolls back without inserting a version', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ revision: 4 }]]);

    await expect(ForesightPlanningRepository.createPlanVersion('business-1', 12, 3, { plan }))
      .rejects.toBeInstanceOf(PlanningThreadConflictError);

    expect(mockConnection.execute).toHaveBeenCalledTimes(1);
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
  });

  it('records validations only when business, thread, version, and plan hash match', async () => {
    mockExecute.mockResolvedValue({ insertId: 51, affectedRows: 1 });

    await expect(ForesightPlanningRepository.recordValidation('business-1', {
      threadId: 12, planVersionId: 41, planHash: 'hash-1', state: 'needs_human',
      findings: { questions: ['Target audience is unresolved.'] }, validatorVersion: 'planner-validator-v1',
    })).resolves.toBe(51);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/plan\.business_id = \?[\s\S]*plan\.thread_id = \?[\s\S]*plan\.plan_hash = \?/),
      expect.arrayContaining(['business-1', 12, 41, 'hash-1']),
    );
  });

  it('completes only a running tenant-scoped tool call with a hashed result', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await expect(ForesightPlanningRepository.completeToolCall('business-1', 61, {
      state: 'succeeded', result: { facts: [{ factId: 'fact-1' }] },
      factIds: ['fact-1'], durationMs: 125,
    })).resolves.toBeUndefined();

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/business_id = \? AND id = \? AND state = 'running'/),
      expect.arrayContaining([
        'succeeded',
        expect.stringContaining('fact-1'),
        expect.stringMatching(/^[a-f0-9]{64}$/),
        '["fact-1"]',
        125,
        'business-1',
        61,
      ]),
    );
  });
});