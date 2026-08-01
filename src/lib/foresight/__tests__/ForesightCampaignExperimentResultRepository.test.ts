import { beforeEach, describe, expect, it, vi } from 'vitest';
const { connection, mockQuery } = vi.hoisted(() => ({
  connection: { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
  mockQuery: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery, getPool: () => ({ getConnection: vi.fn().mockResolvedValue(connection) }) }));
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
  it('lists only exact accepted-design results within the tenant and date range', async () => {
    mockQuery.mockResolvedValue([{ id: 77, business_id: 'business-1', thread_id: 12, experiment_version_id: 55,
      experiment_hash: hash, launch_id: 66, formula_version: 'foresight-experiment-evaluator-v1',
      observation_json: JSON.stringify(observations), assessment_json: JSON.stringify({ status: 'treatment_won', qualityIssues: [] }),
      status: 'treatment_won', primary_metric: 'conversion_rate', control_value: 0.05, treatment_value: 0.09,
      p_value: 0.001, evaluated_by: 7, created_at: '2026-08-17', accepted_at: '2026-08-09' }]);

    const rows = await ForesightCampaignExperimentResultRepository.listAccepted(
      'business-1', { from: '2026-08-01', to: '2026-08-31', limit: 11 });

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("review.action = 'accepted'"),
      ['business-1', '2026-08-01', '2026-08-31']);
    expect(mockQuery.mock.calls[0][0]).toContain('experiment.experiment_hash = result.experiment_hash');
    expect(rows[0]).toMatchObject({ id: 77, observation_json: observations, assessment_json: { status: 'treatment_won' } });
  });
  it('lists experiment workflow only through exact accepted hashes and recommendation links', async () => {
    mockQuery.mockResolvedValue([{ recommendation_id: 20, scheduled_end_on: '2026-08-16', conclusion: null }]);
    const rows = await ForesightCampaignExperimentResultRepository.listWorkflowForRecommendations('business-1', [20, 21]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("link.link_type = 'recommendation'"), ['business-1', '20', '21']);
    expect(mockQuery.mock.calls[0][0]).toContain('review.experiment_hash = experiment.experiment_hash');
    expect(mockQuery.mock.calls[0][0]).toContain('result.experiment_hash = experiment.experiment_hash');
    expect(rows).toEqual([{ recommendation_id: 20, scheduled_end_on: '2026-08-16', conclusion: null }]);
  });
});