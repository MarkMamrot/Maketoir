import { beforeEach, describe, expect, it, vi } from 'vitest';
const { connection } = vi.hoisted(() => ({ connection: { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn(), getPool: () => ({ getConnection: vi.fn().mockResolvedValue(connection) }) }));
import { ForesightCampaignExperimentResultRepository } from '../repositories/ForesightCampaignExperimentResultRepository';

const hash = 'c'.repeat(64);
const design = { primaryMetric: 'conversion_rate', minimumSamplePerVariant: 500, guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }] };
const observations = { source: 'verified_klaviyo_export', observedFrom: '2026-08-10', observedThrough: '2026-08-16', qualityIssues: [],
  control: { sampleSize: 1000, conversions: 50, guardrailEvents: { unsubscribe_rate: 10 } },
  treatment: { sampleSize: 1000, conversions: 90, guardrailEvents: { unsubscribe_rate: 11 } } };
const input = { launchId: 66, experimentVersionId: 55, experimentHash: hash, businessToday: '2026-08-17', observations, evaluatedBy: 7 };

describe('ForesightCampaignExperimentResultRepository', () => {
  beforeEach(() => vi.clearAllMocks());
  it('persists one deterministic result for the exact completed launch', async () => {
    connection.execute.mockResolvedValueOnce([[{ launch_id: 66, launched_on: '2026-08-10', scheduled_end_on: '2026-08-16', experiment_version_id: 55, experiment_hash: hash, experiment_json: design, action: 'accepted' }]]).mockResolvedValueOnce([{ insertId: 77 }]);
    const result = await ForesightCampaignExperimentResultRepository.create('business-1', 12, input);
    expect(result).toMatchObject({ id: 77, status: 'treatment_won', formula_version: 'foresight-experiment-evaluator-v1' });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects evaluation before the attested end date', async () => {
    connection.execute.mockResolvedValueOnce([[{ launch_id: 66, launched_on: '2026-08-10', scheduled_end_on: '2026-08-16', experiment_version_id: 55, experiment_hash: hash, experiment_json: design, action: 'accepted' }]]);
    await expect(ForesightCampaignExperimentResultRepository.create('business-1', 12, { ...input, businessToday: '2026-08-15' })).rejects.toThrow('before the scheduled end');
    expect(connection.execute).toHaveBeenCalledOnce();
  });
  it('persists an underpowered result as inconclusive rather than deferring', async () => {
    connection.execute.mockResolvedValueOnce([[{ launch_id: 66, launched_on: '2026-08-10', scheduled_end_on: '2026-08-16', experiment_version_id: 55, experiment_hash: hash, experiment_json: design, action: 'accepted' }]]).mockResolvedValueOnce([{ insertId: 78 }]);
    const result = await ForesightCampaignExperimentResultRepository.create('business-1', 12, { ...input, observations: { ...observations, treatment: { ...observations.treatment, sampleSize: 400 } } });
    expect(result.status).toBe('inconclusive'); expect(connection.commit).toHaveBeenCalledOnce();
  });
});