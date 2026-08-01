import { beforeEach, describe, expect, it, vi } from 'vitest';
const { connection } = vi.hoisted(() => ({ connection: { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn(), getPool: () => ({ getConnection: vi.fn().mockResolvedValue(connection) }) }));
import { CampaignExperimentTransitionError, ForesightCampaignExperimentRepository } from '../repositories/ForesightCampaignExperimentRepository';

const lessonHash = 'a'.repeat(64);
const document = { schemaVersion: 1, lessonVersionId: 44, lessonHash, title: 'Offer test',
  hypothesis: { text: 'Test clearer framing.', citationFactIds: ['foresight:campaign-lesson:44:v1'] }, channel: 'klaviyo', audience: 'Random eligible subscribers.',
  control: { name: 'Control', description: 'Current framing.' }, treatment: { name: 'Treatment', description: 'Clear framing.' }, allocationPercent: { control: 50, treatment: 50 },
  startDate: '2026-08-10', endDate: '2026-08-16', minimumSamplePerVariant: 500, primaryMetric: 'conversion_rate', minimumDetectableLiftPercent: 10,
  guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }], analysis: { method: 'frequentist_two_sided', confidenceLevel: 0.95, inconclusiveWhenUnderpowered: true },
  limitations: ['Attribution may be incomplete.'], executable: false };

describe('ForesightCampaignExperimentRepository', () => {
  beforeEach(() => vi.clearAllMocks());
  it('creates an immutable experiment from the exact accepted lesson', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 44, lesson_hash: lessonHash, version: 1, action: 'accepted' }]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 55 }]);
    const result = await ForesightCampaignExperimentRepository.createVersion('business-1', 12, { lessonVersionId: 44, lessonHash, lessonVersion: 1, document, modelId: 'gemini', promptVersion: 'campaign-experiment-v1', authoredBy: 7 });
    expect(result).toMatchObject({ id: 55, version: 1, experiment_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects an unaccepted lesson before experiment insertion', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 44, lesson_hash: lessonHash, version: 1, action: 'rejected' }]]);
    await expect(ForesightCampaignExperimentRepository.createVersion('business-1', 12, { lessonVersionId: 44, lessonHash, lessonVersion: 1, document, modelId: 'gemini', promptVersion: 'campaign-experiment-v1', authoredBy: 7 })).rejects.toBeInstanceOf(CampaignExperimentTransitionError);
    expect(connection.execute).toHaveBeenCalledOnce(); expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it('does not supersede an accepted experiment', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 44, lesson_hash: lessonHash, version: 1, action: 'accepted' }]]).mockResolvedValueOnce([[{ id: 55, version: 1, action: 'accepted' }]]);
    await expect(ForesightCampaignExperimentRepository.createVersion('business-1', 12, { lessonVersionId: 44, lessonHash, lessonVersion: 1, document, modelId: 'gemini', promptVersion: 'campaign-experiment-v1', authoredBy: 7 })).rejects.toThrow('cannot be superseded');
  });
});