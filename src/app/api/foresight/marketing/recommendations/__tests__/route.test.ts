import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockRequireAdminTier, mockEvaluate, mockEvaluateGa4, mockEvaluateKlaviyo, mockEvaluateOutcomes, mockEvaluateCampaignOutcomes, mockList, mockLatestStrategy, mockListEvents, mockListOutcomes, mockListImplementations, mockListExecutions } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockRequireAdminTier: vi.fn(),
  mockEvaluate: vi.fn(),
  mockEvaluateGa4: vi.fn(),
  mockEvaluateKlaviyo: vi.fn(),
  mockEvaluateOutcomes: vi.fn(),
  mockEvaluateCampaignOutcomes: vi.fn(),
  mockList: vi.fn(),
  mockLatestStrategy: vi.fn(),
  mockListEvents: vi.fn(),
  mockListOutcomes: vi.fn(),
  mockListImplementations: vi.fn(),
  mockListExecutions: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  requireAdminTier: mockRequireAdminTier,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: vi.fn(async (_businessId, callback) => callback()),
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney',
  getBusinessTimeZone: vi.fn().mockResolvedValue('Australia/Sydney'),
}));
vi.mock('@/lib/foresight/ForesightRecommendationService', () => ({
  ForesightRecommendationService: { evaluatePaidMedia: mockEvaluate },
}));
vi.mock('@/lib/foresight/KlaviyoRecommendationService', () => ({
  KlaviyoRecommendationService: { evaluateLifecycle: mockEvaluateKlaviyo },
}));
vi.mock('@/lib/foresight/Ga4RecommendationService', () => ({
  Ga4RecommendationService: { evaluateChannels: mockEvaluateGa4 },
}));
vi.mock('@/lib/foresight/ForesightOutcomeService', () => ({
  ForesightOutcomeService: { evaluateDuePaidMedia: mockEvaluateOutcomes, evaluateDueCampaigns: mockEvaluateCampaignOutcomes },
}));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: {
    listRecommendations: mockList,
    latestStrategy: mockLatestStrategy,
    listRecommendationEvents: mockListEvents,
    listRecommendationOutcomes: mockListOutcomes,
    listRecommendationImplementations: mockListImplementations,
  },
}));
vi.mock('@/lib/foresight/repositories/ForesightExecutionRepository', () => ({
  ForesightExecutionRepository: { listForRecommendations: mockListExecutions },
}));

import { GET, POST } from '../route';

describe('/api/foresight/marketing/recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1' } });
    mockEvaluate.mockResolvedValue({ recommendationCount: 0, expiredCount: 0, recommendations: [] });
    mockEvaluateGa4.mockResolvedValue({ recommendationCount: 0, expiredCount: 0, recommendations: [], skipped: false });
    mockEvaluateKlaviyo.mockResolvedValue({ recommendationCount: 0, expiredCount: 0, recommendations: [], skipped: true });
    mockList.mockResolvedValue([]);
    mockLatestStrategy.mockResolvedValue(null);
    mockListEvents.mockResolvedValue([]);
    mockListOutcomes.mockResolvedValue([]);
    mockListImplementations.mockResolvedValue([]);
    mockListExecutions.mockResolvedValue([]);
    mockEvaluateOutcomes.mockResolvedValue({ measuredCount: 0, deferredCount: 0, outcomes: [] });
    mockEvaluateCampaignOutcomes.mockResolvedValue({ measuredCount: 0, deferredCount: 0, outcomes: [] });
  });

  it('evaluates only for the authenticated business', async () => {
    const response = await POST(new Request('http://localhost/api/foresight/marketing/recommendations', {
      method: 'POST',
      body: JSON.stringify({ through: '2026-07-28' }),
    }));

    expect(response.status).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith('business-1', '2026-07-28');
    expect(mockEvaluateGa4).toHaveBeenCalledWith('business-1', '2026-07-28');
    expect(mockEvaluateKlaviyo).toHaveBeenCalledWith('business-1', '2026-07-28');
    expect(mockEvaluateOutcomes).toHaveBeenCalledWith('business-1', '2026-07-28');
    expect(mockEvaluateCampaignOutcomes).toHaveBeenCalledWith('business-1', '2026-07-28');
  });

  it('rejects invalid evaluation dates', async () => {
    const response = await POST(new Request('http://localhost/api/foresight/marketing/recommendations', {
      method: 'POST',
      body: JSON.stringify({ through: 'bad-date' }),
    }));

    expect(response.status).toBe(400);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('lists active recommendations for the authenticated business', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith('business-1', [
      'shadow', 'pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'compensated', 'rejected',
    ]);
    expect(mockListEvents).toHaveBeenCalledWith('business-1', []);
    expect(mockListOutcomes).toHaveBeenCalledWith('business-1', []);
    expect(mockListImplementations).toHaveBeenCalledWith('business-1', []);
    expect(mockListExecutions).toHaveBeenCalledWith('business-1', []);
    const body = await response.json();
    expect(body.paidMediaPolicy).toMatchObject({ minimumContributionPoas: 1, merDeteriorationPercent: 25 });
  });
});