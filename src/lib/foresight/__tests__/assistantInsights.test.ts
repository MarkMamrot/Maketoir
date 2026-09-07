import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetDailyMarketingMetrics,
  mockListRecommendations,
  mockListOutcomes,
  mockListImplementations,
  mockListExecutions,
  mockListExperimentWorkflows,
} = vi.hoisted(() => ({
  mockGetDailyMarketingMetrics: vi.fn(),
  mockListRecommendations: vi.fn(),
  mockListOutcomes: vi.fn(),
  mockListImplementations: vi.fn(),
  mockListExecutions: vi.fn(),
  mockListExperimentWorkflows: vi.fn(),
}));

vi.mock('../ForesightMetricsService', () => ({
  ForesightMetricsService: { getDailyMarketingMetrics: mockGetDailyMarketingMetrics },
}));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    listRecommendations: mockListRecommendations,
    listRecommendationOutcomes: mockListOutcomes,
    listRecommendationImplementations: mockListImplementations,
  },
}));
vi.mock('../repositories/ForesightExecutionRepository', () => ({
  ForesightExecutionRepository: { listForRecommendations: mockListExecutions },
}));
vi.mock('../repositories/ForesightCampaignExperimentResultRepository', () => ({
  ForesightCampaignExperimentResultRepository: { listWorkflowForRecommendations: mockListExperimentWorkflows },
}));

import { loadAssistantMarketingPerformance, loadAssistantMarketingRecommendations } from '../assistantInsights';

describe('Foresight Assistant insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarises governed marketing and commerce metrics without account or entity identities', async () => {
    mockGetDailyMarketingMetrics.mockResolvedValueOnce({
      paidMedia: [
        { metricDate: '2026-09-01', source: 'google_ads', accountId: 'secret-google', spend: 100, impressions: 1000, clicks: 50, conversions: 4, attributedRevenue: 300, currencyCode: 'AUD' },
        { metricDate: '2026-09-01', source: 'meta_ads', accountId: 'secret-meta', spend: 50, impressions: 500, clicks: 20, conversions: 2, attributedRevenue: 100, currencyCode: 'AUD' },
      ],
      paidMediaEntities: [{ entityId: 'secret-campaign', entityName: 'Private campaign' }],
      commerce: [
        { metricDate: '2026-09-01', channel: 'online', salesIncTax: 550, salesTax: 50, returnsIncTax: 55, returnsTax: 5, salesCogs: 200, returnedCogs: 20, orderCount: 5, returnCount: 1, costLineCount: 4, missingCostLineCount: 1, costBasis: 'mixed' },
        { metricDate: '2026-09-01', channel: 'pos', salesIncTax: 220, salesTax: 20, returnsIncTax: 0, returnsTax: 0, salesCogs: 80, returnedCogs: 0, orderCount: 3, returnCount: 0, costLineCount: 3, missingCostLineCount: 0, costBasis: 'captured' },
      ],
      reconciliation: [{
        metricDate: '2026-09-01', onlineNetRevenueExTax: 450, posNetRevenueExTax: 200,
        paidMedia: { paidMediaSpend: 150 },
        qualityIssues: [{ code: 'incomplete_online_cogs', severity: 'blocking', message: 'One line has no usable cost.' }],
      }],
    });

    const result = await loadAssistantMarketingPerformance({ businessId: 'biz-1', fromDate: '2026-09-01', toDate: '2026-09-05' });

    expect(mockGetDailyMarketingMetrics).toHaveBeenCalledWith('biz-1', '2026-09-01', '2026-09-05');
    expect(result).toMatchObject({
      latestDataDate: '2026-09-01',
      paidMedia: [
        { source: 'google_ads', spend: 100, attributedRevenue: 300, platformRoas: 3 },
        { source: 'meta_ads', spend: 50, attributedRevenue: 100, platformRoas: 2 },
      ],
      commerce: [
        { channel: 'online', netSalesTaxInclusive: 495, extractedTax: 45, netRevenueTaxExclusive: 450, costCoveragePercent: 80 },
        { channel: 'pos', netSalesTaxInclusive: 220, extractedTax: 20, netRevenueTaxExclusive: 200, costCoveragePercent: 100 },
      ],
      totals: { paidMediaSpend: 150, onlineNetRevenueTaxExclusive: 450, paidMediaEcommerceMer: 3 },
      quality: { grade: 'blocked' },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-google|secret-meta|secret-campaign|accountId|entityId/i);
  });

  it('returns bounded sanitized recommendations with source-owned operational status', async () => {
    mockListRecommendations.mockResolvedValueOnce([{
      id: 42, business_id: 'biz-1', fingerprint: 'private', state: 'succeeded', channel: 'google_ads',
      subject_type: 'campaign', subject_id: 'external-123', rule_id: 'profitable_growth_opportunity',
      evidence_json: {
        metricKeys: ['paid_media_mer'], sourceIds: ['private-account'], windowStart: '2026-08-01', windowEnd: '2026-08-07',
        quality: { grade: 'good', issues: [] }, observedValues: { paid_media_mer: 4.2 },
        contributors: [{ entityName: 'Private campaign' }],
      },
      proposed_action_json: { type: 'review_capped_budget_increase', reason: 'Private generated rationale', secret: 'omit' },
      proposal_hash: 'private-hash', confidence: 0.86, expected_impact_low: 10, expected_impact_high: 20,
      expires_at: null, created_at: '2026-08-08', updated_at: '2026-08-08',
    }]);
    mockListOutcomes.mockResolvedValueOnce([]);
    mockListImplementations.mockResolvedValueOnce([{ recommendation_id: 42, implemented_on: '2026-08-10' }]);
    mockListExecutions.mockResolvedValueOnce([{ recommendation_id: 42, state: 'succeeded', compensates_execution_id: null, request_json: { secret: true } }]);
    mockListExperimentWorkflows.mockResolvedValueOnce([]);

    const result = await loadAssistantMarketingRecommendations({ businessId: 'biz-1', businessToday: '2026-08-12', limit: 20 });

    const ids = [42];
    expect(mockListRecommendations.mock.calls[0][0]).toBe('biz-1');
    expect(mockListOutcomes).toHaveBeenCalledWith('biz-1', ids);
    expect(mockListImplementations).toHaveBeenCalledWith('biz-1', ids);
    expect(mockListExecutions).toHaveBeenCalledWith('biz-1', ids);
    expect(mockListExperimentWorkflows).toHaveBeenCalledWith('biz-1', ids);
    expect(result.rows[0]).toMatchObject({
      recommendationId: 42,
      state: 'succeeded',
      actionType: 'review_capped_budget_increase',
      confidencePercent: 86,
      observedValues: { paid_media_mer: 4.2 },
      operationalStatus: { followup: { status: 'monitoring', followupStart: '2026-08-11', followupEnd: '2026-08-17' } },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-account|Private campaign|external-123|Private generated rationale|private-hash|request_json|secret/i);
  });
});
