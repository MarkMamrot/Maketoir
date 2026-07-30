import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMetrics, mockCreateRecommendation, mockExpire, mockLatestStrategy, mockEvaluateRules } = vi.hoisted(() => ({
  mockGetMetrics: vi.fn(),
  mockCreateRecommendation: vi.fn(),
  mockExpire: vi.fn(),
  mockLatestStrategy: vi.fn(),
  mockEvaluateRules: vi.fn(() => [{
    fingerprint: 'rule:fingerprint',
    channel: 'paid_media',
    subjectType: 'portfolio',
    subjectId: 'google_meta_blended',
    ruleId: 'mer_deterioration',
    evidence: {
      metricKeys: ['paid_media_ecommerce_mer'], sourceIds: ['source'],
      windowStart: '2026-07-23', windowEnd: '2026-07-29', quality: { grade: 'good', issues: [] },
    },
    proposedAction: { type: 'review_channel_and_campaign_mix' },
    confidence: 0.8,
    expectedImpactLow: null,
    expectedImpactHigh: null,
  }]),
}));

vi.mock('../ForesightMetricsService', () => ({
  ForesightMetricsService: { getDailyMarketingMetrics: mockGetMetrics },
}));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    latestStrategy: mockLatestStrategy,
    createRecommendation: mockCreateRecommendation,
    expireSupersededShadowRecommendations: mockExpire,
  },
}));
vi.mock('../rules/paidMediaPortfolioRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rules/paidMediaPortfolioRules')>();
  return {
    ...actual,
    evaluatePaidMediaPortfolioRules: mockEvaluateRules,
  };
});

import { ForesightRecommendationService } from '../ForesightRecommendationService';

describe('ForesightRecommendationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetrics.mockResolvedValue({ reconciliation: [], paidMediaEntities: [] });
    mockLatestStrategy.mockResolvedValue(null);
    mockCreateRecommendation.mockResolvedValue(42);
    mockExpire.mockResolvedValue(2);
  });

  it('evaluates a trailing fourteen-day dataset and persists shadow inputs', async () => {
    const result = await ForesightRecommendationService.evaluatePaidMedia('business-1', '2026-07-29');

    expect(mockGetMetrics).toHaveBeenCalledWith('business-1', '2026-07-16', '2026-07-29');
    expect(mockEvaluateRules).toHaveBeenCalledWith([], expect.objectContaining({
      strategyVersion: 0,
      minimumCurrentDays: 7,
      minimumContributionPoas: 1,
    }), []);
    expect(mockCreateRecommendation).toHaveBeenCalledWith('business-1', expect.objectContaining({
      fingerprint: 'rule:fingerprint',
      channel: 'paid_media',
      policyVersion: 1,
      formulaVersion: 'foresight-paid-media-rules-v1',
      expiresAt: '2026-08-05 23:59:59',
    }));
    expect(mockExpire).toHaveBeenCalledWith(
      'business-1',
      expect.arrayContaining(['mer_deterioration']),
      ['rule:fingerprint'],
    );
    expect(result).toMatchObject({ recommendationCount: 1, expiredCount: 2 });
  });

  it('uses the latest business strategy for the lookback and rule policy', async () => {
    mockLatestStrategy.mockResolvedValue({
      version: 4,
      strategy_json: {
        schemaVersion: 1,
        objective: 'efficiency',
        paidMedia: {
          targetMer: 4,
          minimumContributionPoas: 1.25,
          evaluationWindowDays: 14,
          minimumSpend: 500,
          zeroRevenueSpend: 250,
          merDeteriorationPercent: 15,
          maximumBudgetReductionPercent: 8,
        },
      },
    });

    const result = await ForesightRecommendationService.evaluatePaidMedia('business-1', '2026-07-29');

    expect(mockGetMetrics).toHaveBeenCalledWith('business-1', '2026-07-02', '2026-07-29');
    expect(mockEvaluateRules).toHaveBeenCalledWith([], {
      strategyVersion: 4,
      minimumCurrentDays: 14,
      minimumSpend: 500,
      zeroRevenueSpend: 250,
      merDeteriorationPercent: 15,
      minimumContributionPoas: 1.25,
      maximumBudgetReductionPercent: 8,
      targetMer: 4,
      growthMinimumContributionPoas: 3,
      maximumBudgetIncreasePercent: 10,
    }, []);
    expect(result.strategyVersion).toBe(4);
  });
});