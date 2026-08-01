import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection } = vi.hoisted(() => ({
  connection: { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock('@/services/MySQLService', () => ({
  query: vi.fn(), getPool: () => ({ getConnection: vi.fn().mockResolvedValue(connection) }),
}));

import { CampaignLessonTransitionError, ForesightCampaignLessonRepository } from '../repositories/ForesightCampaignLessonRepository';

const document = {
  schemaVersion: 1, outcomeId: 93, activationId: 91, title: 'Campaign observation',
  observations: [{ text: 'Contribution increased.', citationFactIds: ['foresight:campaign-outcome:93:activation:91'] }],
  limitations: ['Observational comparison only.'],
  hypotheses: [{ text: 'Selection may merit another test.', status: 'requires_human_validation', validationApproach: 'Run a reviewed test.' }],
  suggestedApplications: [{ text: 'Consider in related planning.', executable: false }],
};

describe('ForesightCampaignLessonRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an immutable first version bound to the exact outcome and activation', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 93, activation_id: 91, thread_id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 101 }]);
    const result = await ForesightCampaignLessonRepository.createVersion('business-1', 12, {
      outcomeId: 93, activationId: 91, document, modelId: 'gemini', promptVersion: 'campaign-learning-v1', authoredBy: 7,
    });
    expect(result).toMatchObject({ id: 101, version: 1, parent_id: null, lesson_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back before insertion when activation does not match the tenant outcome', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 93, activation_id: 92, thread_id: 12 }]]);
    await expect(ForesightCampaignLessonRepository.createVersion('business-1', 12, {
      outcomeId: 93, activationId: 91, document, modelId: 'gemini', promptVersion: 'campaign-learning-v1', authoredBy: 7,
    })).rejects.toBeInstanceOf(CampaignLessonTransitionError);
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('does not supersede an accepted lesson', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 93, activation_id: 91, thread_id: 12 }]])
      .mockResolvedValueOnce([[{ id: 101, version: 1, action: 'accepted' }]]);
    await expect(ForesightCampaignLessonRepository.createVersion('business-1', 12, {
      outcomeId: 93, activationId: 91, document, modelId: 'gemini', promptVersion: 'campaign-learning-v1', authoredBy: 7,
    })).rejects.toThrow('cannot be superseded');
    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});