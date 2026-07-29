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

import { ForesightRepository, hashProposal } from '../repositories/ForesightRepository';

describe('ForesightRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hashes an action proposal deterministically', () => {
    expect(hashProposal({ type: 'pause_campaign', campaignId: '123' })).toBe(
      hashProposal({ campaignId: '123', type: 'pause_campaign' }),
    );
    expect(hashProposal(null)).toBeNull();
  });

  it('creates recommendations in shadow state and returns existing IDs idempotently', async () => {
    mockExecute.mockResolvedValue({ insertId: 42 });

    const id = await ForesightRepository.createRecommendation('business-1', {
      fingerprint: 'rule:subject:window',
      channel: 'klaviyo',
      subjectType: 'flow',
      subjectId: 'flow-1',
      ruleId: 'missing_post_purchase_flow',
      evidence: {
        metricKeys: ['klaviyo_flow_count'],
        sourceIds: ['sync-1'],
        windowStart: '2026-07-01',
        windowEnd: '2026-07-29',
        quality: { grade: 'good', issues: [] },
      },
    });

    expect(id).toBe(42);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, 'shadow'"),
      expect.arrayContaining(['business-1', 'rule:subject:window', 'klaviyo', 'flow']),
    );
  });

  it('returns no recommendations when no states are requested', async () => {
    await expect(ForesightRepository.listRecommendations('business-1', [])).resolves.toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('expires only superseded shadow recommendations for the evaluated rules', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 2 });

    await expect(ForesightRepository.expireSupersededShadowRecommendations(
      'business-1',
      ['mer_deterioration', 'contribution_poas_below_one'],
      ['active-fingerprint'],
    )).resolves.toBe(2);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringMatching(/state = 'shadow'[\s\S]*fingerprint NOT IN/),
      ['business-1', 'mer_deterioration', 'contribution_poas_below_one', 'active-fingerprint'],
    );
  });

  it('loads only due tenant-scoped paid-media outcome candidates', async () => {
    mockQuery.mockResolvedValue([]);

    await ForesightRepository.listRecommendationOutcomeCandidates('business-1', '2026-07-29', 7);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/r\.business_id = \?[\s\S]*r\.channel = 'paid_media'[\s\S]*o\.id IS NULL/),
      [7, 'business-1', '2026-07-29'],
    );
  });

  it('persists recommendation outcomes idempotently', async () => {
    mockExecute.mockResolvedValue({ insertId: 81 });
    const assessment = {
      direction: 'improved' as const,
      conditionState: 'resolved' as const,
      primaryMetric: 'paid_media_ecommerce_mer',
      baselineValue: 1.5,
      followupValue: 2.5,
      followup: {
        windowStart: '2026-07-11', windowEnd: '2026-07-17', spend: 700,
        onlineRevenueExTax: 1750, contributionPoas: 1.2, mer: 2.5, qualityIssues: [],
      },
      explanation: 'Recovered.',
    };

    await expect(ForesightRepository.createRecommendationOutcome('business-1', {
      recommendationId: 42,
      decision: 'approved',
      horizonDays: 7,
      baselineStart: '2026-07-01',
      baselineEnd: '2026-07-07',
      followupStart: '2026-07-11',
      followupEnd: '2026-07-17',
      assessment,
    })).resolves.toBe(81);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'),
      expect.arrayContaining(['business-1', 42, 'approved', 7, 'improved', 'resolved']),
    );
  });

  it('requests approval transactionally only when the proposal hash still matches', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{ state: 'shadow', proposal_hash: 'hash-1' }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await ForesightRepository.requestRecommendationApproval(
      'business-1', 42, 7, 'hash-1', 'ready_for_review', 'Review this proposal.',
    );

    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET state = 'pending_approval'"),
      ['business-1', 42],
    );
    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_recommendation_events'),
      ['business-1', 42, 'hash-1', 7, 'ready_for_review', 'Review this proposal.'],
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back approval requests when the proposal hash is stale', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ state: 'shadow', proposal_hash: 'current-hash' }]]);

    await expect(ForesightRepository.requestRecommendationApproval(
      'business-1', 42, 7, 'stale-hash', 'ready_for_review',
    )).rejects.toThrow('proposal changed');

    expect(mockConnection.rollback).toHaveBeenCalledOnce();
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });
});