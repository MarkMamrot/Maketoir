import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAssistantEscalation, reportWorkflowFinding, type AssistantFindingDependencies } from '../findings';

const connection = {
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const dependencies: AssistantFindingDependencies = {
  getConnection: vi.fn().mockResolvedValue(connection),
  now: () => new Date('2026-08-21T10:00:00.000Z'),
  createPublicReference: () => 'SOL-ABC12345',
};

const evidence = {
  category: 'workflow_gap' as const,
  audience: 'ims' as const,
  capability: 'orders',
  goal: 'Complete an essential order workflow',
  essentialConstraints: ['Keep existing stock history'],
  attemptedPath: 'Current order action',
  alternativesChecked: [{ path: 'Documented alternative', limitation: 'Does not preserve the required outcome' }],
  userConfirmedBlocked: true,
  currentView: 'orders',
};

describe('assistant finding persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
  });

  it('upserts a globally fingerprinted finding and records the affected business', async () => {
    connection.execute
      .mockResolvedValueOnce([{ insertId: 17 }, []])
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await expect(reportWorkflowFinding({
      businessId: 'biz-1', evidence, impact: 'high', confidence: 0.8,
    }, dependencies)).resolves.toBe(17);

    expect(connection.execute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(connection.execute.mock.calls[1][0]).toContain('assistant_workflow_finding_businesses');
    expect(connection.execute.mock.calls[3][0]).toContain('affected_business_count');
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('creates an idempotent user case and returns the persisted public reference', async () => {
    connection.execute
      .mockResolvedValueOnce([{ insertId: 23 }, []])
      .mockResolvedValueOnce([[{
        public_reference: 'SOL-EXISTING',
        response_due_at: new Date('2026-08-26T10:00:00.000Z'),
      }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(createAssistantEscalation({
      parentKind: 'workflow_finding',
      parentId: 17,
      businessId: 'biz-1',
      audience: 'ims',
      actorType: 'ims_user',
      actorId: 5,
      canFollowUpDirectly: true,
      idempotencyKey: 'a'.repeat(64),
    }, dependencies)).resolves.toEqual({
      id: 23,
      publicReference: 'SOL-EXISTING',
      responseDueAt: new Date('2026-08-26T10:00:00.000Z'),
    });

    expect(connection.execute.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back and never returns a reference when persistence fails', async () => {
    connection.execute.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(createAssistantEscalation({
      parentKind: 'runtime_issue',
      parentId: 8,
      businessId: 'biz-1',
      audience: 'pos',
      actorType: 'pos_user',
      actorId: 4,
      canFollowUpDirectly: false,
      idempotencyKey: 'b'.repeat(64),
    }, dependencies)).rejects.toThrow('database unavailable');

    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});