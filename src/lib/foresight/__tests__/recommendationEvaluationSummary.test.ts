import { describe, expect, it } from 'vitest';
import { buildRecommendationEvaluationSummary } from '../recommendationEvaluationSummary';
import type { WeeklyDigestSnapshot } from '../weeklyDigest';

function digest(overrides: Partial<WeeklyDigestSnapshot['current']> = {}): WeeklyDigestSnapshot {
  return {
    version: 1,
    digestType: 'weekly_summary',
    digestDate: '2026-07-29',
    current: {
      windowStart: '2026-07-23', windowEnd: '2026-07-29', expectedDays: 7, observedDays: 7,
      complete: true, googleAdsSpend: 500, metaAdsSpend: 0, paidMediaSpend: 500,
      onlineRevenueExTax: 4000, posRevenueExTax: 20000, contributionBeforeAds: 2500,
      mer: 8, contributionPoas: 5, platformAttributedRevenue: { googleAds: 3900, metaAds: 0 },
      currencyCodes: ['AUD'], qualityIssues: [], ...overrides,
    },
    previous: {
      windowStart: '2026-07-16', windowEnd: '2026-07-22', expectedDays: 7, observedDays: 7,
      complete: true, googleAdsSpend: 600, metaAdsSpend: 0, paidMediaSpend: 600,
      onlineRevenueExTax: 4200, posRevenueExTax: 21000, contributionBeforeAds: 2400,
      mer: 7, contributionPoas: 4, platformAttributedRevenue: { googleAds: 4000, metaAds: 0 },
      currencyCodes: ['AUD'], qualityIssues: [],
    },
    changes: { spendPercent: -16.7, onlineRevenuePercent: -4.8, merPercent: 14.3, contributionPoasPercent: 25 },
    operations: { recommendationsCreated: 0, approvals: 0, rejections: 0, implementations: 0, outcomes: { total: 0, improved: 0, unchanged: 0, worsened: 0, unavailable: 0 } },
    klaviyo: { current: { observedAt: null, activeCriticalFlows: null, missingCriticalFlows: null, inactiveCriticalFlows: null, categories: [] }, previous: { observedAt: null, activeCriticalFlows: null, missingCriticalFlows: null, inactiveCriticalFlows: null, categories: [] } },
    contributors: [], notices: [],
  };
}

describe('recommendation evaluation summary', () => {
  it('explains a healthy empty recommendation result', () => {
    const result = buildRecommendationEvaluationSummary(digest());
    expect(result.status).toBe('healthy');
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('identifies failed contribution and MER checks', () => {
    const input = digest({ contributionPoas: 0.8 });
    input.changes.merPercent = -30;
    const result = buildRecommendationEvaluationSummary(input);
    expect(result.status).toBe('attention');
    expect(result.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual([
      'contribution_poas', 'mer_deterioration',
    ]);
  });

  it('does not claim health without a complete current window', () => {
    expect(buildRecommendationEvaluationSummary(digest({ complete: false })).status).toBe('insufficient_data');
  });
});