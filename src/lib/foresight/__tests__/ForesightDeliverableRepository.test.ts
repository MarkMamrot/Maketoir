import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockConnection } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnection: {
    beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  },
}));
vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
}));
vi.mock('../repositories/ForesightPlanningRepository', () => ({
  ForesightPlanningRepository: { latestPlanVersion: vi.fn(), latestPlanReview: vi.fn() },
}));

import {
  DeliverableTransitionError,
  ForesightDeliverableRepository,
} from '../repositories/ForesightDeliverableRepository';

const document = {
  schemaVersion: 1, title: 'Campaign drafts', planVersionId: 41, planHash: 'a'.repeat(64), objective: 'Grow profitably.',
  audience: ['Gift buyers'], productSelection: [{ name: 'Legami', rationale: 'Demand.', citationFactIds: ['fact-1'] }],
  offerConstraints: [], creativeDirection: ['Product-led'], assets: [{ id: 'brief', channel: 'campaign_brief',
    assetType: 'brief', title: 'Campaign brief', content: 'A reviewed campaign brief.', publishable: false,
    claims: [{ text: 'Demand exists.', citationFactIds: ['fact-1'] }], reviewNotes: [] }],
  trackingRequirements: ['UTMs'], successMetrics: ['Contribution'], guardrails: ['Manual publish'], reviewDate: null,
  stopConditions: ['Stock constraint'],
};

describe('ForesightDeliverableRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an immutable child package only from the exact accepted plan', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: 41, plan_hash: 'a'.repeat(64) }]])
      .mockResolvedValueOnce([[{ action: 'accepted' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 80 }]);

    const result = await ForesightDeliverableRepository.createVersion('business-1', 12, {
      planVersionId: 41, planHash: 'a'.repeat(64), knownFactIds: ['fact-1'], document,
      modelId: 'gemini', promptVersion: 'campaign-deliverables-v1', authoredBy: 7,
    });

    expect(result).toMatchObject({ id: 80, version: 1, parent_id: null, document_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(mockConnection.execute).toHaveBeenNthCalledWith(4,
      expect.stringContaining('INSERT INTO foresight_deliverable_versions'),
      expect.arrayContaining(['business-1', 12, 41, 'a'.repeat(64), 1, null]),
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('rejects an unaccepted source plan before deliverable insertion', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: 41, plan_hash: 'a'.repeat(64) }]])
      .mockResolvedValueOnce([[{ action: 'submitted' }]]);

    await expect(ForesightDeliverableRepository.createVersion('business-1', 12, {
      planVersionId: 41, planHash: 'a'.repeat(64), knownFactIds: ['fact-1'], document,
      modelId: 'gemini', promptVersion: 'campaign-deliverables-v1', authoredBy: 7,
    })).rejects.toBeInstanceOf(DeliverableTransitionError);

    expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
  });

  it('requires human detail for a revision request', async () => {
    mockConnection.execute.mockResolvedValueOnce([[[{
      id: 80, document_hash: 'b'.repeat(64), action: null,
    }]]]);

    await expect(ForesightDeliverableRepository.review('business-1', 12, {
      deliverableVersionId: 80, documentHash: 'b'.repeat(64), action: 'revision_requested', actorId: 7,
    })).rejects.toBeInstanceOf(DeliverableTransitionError);
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
  });
});