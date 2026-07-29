import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMetrics, mockCreateRecommendation, mockExpire } = vi.hoisted(() => ({
  mockGetMetrics: vi.fn(),
  mockCreateRecommendation: vi.fn(),
  mockExpire: vi.fn(),
}));

vi.mock('../ForesightMetricsService', () => ({
  ForesightMetricsService: { getDailyMarketingMetrics: mockGetMetrics },
}));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    createRecommendation: mockCreateRecommendation,
    expireSupersededShadowRecommendations: mockExpire,
  },
}));
vi.mock('../rules/paidMediaPortfolioRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rules/paidMediaPortfolioRules')>();
  return {
    ...actual,
    evaluatePaidMediaPortfolioRules: vi.fn(() => [{
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
  };
});

import { ForesightRecommendationService } from '../ForesightRecommendationService';

describe('ForesightRecommendationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetrics.mockResolvedValue({ reconciliation: [] });
    mockCreateRecommendation.mockResolvedValue(42);
    mockExpire.mockResolvedValue(2);
  });

  it('evaluates a trailing fourteen-day dataset and persists shadow inputs', async () => {
    const result = await ForesightRecommendationService.evaluatePaidMedia('business-1', '2026-07-29');

    expect(mockGetMetrics).toHaveBeenCalledWith('business-1', '2026-07-16', '2026-07-29');
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
});