import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTier, mockGetRecommendation, mockFindThread, mockLatestPlan, mockLatestReview, mockLatestDeliverable, mockLatestDeliverableReview, mockLatestActivation, mockGetOrCreate } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTier: vi.fn(), mockGetRecommendation: vi.fn(), mockFindThread: vi.fn(),
  mockLatestPlan: vi.fn(), mockLatestReview: vi.fn(), mockLatestDeliverable: vi.fn(), mockLatestDeliverableReview: vi.fn(), mockLatestActivation: vi.fn(), mockGetOrCreate: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, requireAdminTier: mockTier }));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: { getRecommendation: mockGetRecommendation },
}));
vi.mock('@/lib/foresight/repositories/ForesightPlanningRepository', () => ({
  ForesightPlanningRepository: {
    findThreadForLink: mockFindThread, latestPlanVersion: mockLatestPlan, latestPlanReview: mockLatestReview,
    getOrCreateRecommendationThread: mockGetOrCreate,
  },
}));
vi.mock('@/lib/foresight/repositories/ForesightDeliverableRepository', () => ({
  ForesightDeliverableRepository: { latest: mockLatestDeliverable, latestReview: mockLatestDeliverableReview },
}));
vi.mock('@/lib/foresight/repositories/ForesightCampaignActivationRepository', () => ({
  ForesightCampaignActivationRepository: { getForThread: mockLatestActivation },
}));

import { GET, POST } from '../route';

const context = { params: { id: '42' } };

describe('/api/foresight/marketing/recommendations/[id]/planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockGetRecommendation.mockResolvedValue({ id: 42, rule_id: 'profitable_growth_opportunity' });
    mockFindThread.mockResolvedValue(null);
    mockLatestReview.mockResolvedValue(null);
    mockLatestDeliverable.mockResolvedValue(null);
    mockLatestDeliverableReview.mockResolvedValue(null);
    mockLatestActivation.mockResolvedValue(null);
    mockGetOrCreate.mockResolvedValue({ threadId: 12, created: true });
  });

  it('returns an existing linked thread using the session tenant', async () => {
    mockFindThread.mockResolvedValue({ id: 11, business_id: 'business-1' });
    mockLatestPlan.mockResolvedValue({
      id: 8, version: 2, state: 'locked_for_approval', plan_hash: 'hash-2',
      plan_json: {
        title: 'Growth plan', objective: 'Grow contribution.', planningHorizon: '30 days',
        selectedOptionId: 'focused', options: [{ id: 'focused', title: 'Focused', summary: 'Focus spend.', benefits: [], risks: [], evidenceRequired: [] }],
        actions: [], questions: [], successMetrics: ['Contribution'], guardrails: ['Human approval'],
      },
    });
    mockLatestReview.mockResolvedValue({ plan_version_id: 8, plan_hash: 'hash-2', action: 'submitted' });
    const response = await GET(new Request('http://localhost'), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.thread.id).toBe(11);
    expect(body.latestPlan).toMatchObject({ version: 2, planHash: 'hash-2', review: { action: 'submitted' } });
    expect(mockGetRecommendation).toHaveBeenCalledWith('business-1', 42);
    expect(mockFindThread).toHaveBeenCalledWith('business-1', 'recommendation', '42');
  });

  it('reuses an existing thread instead of creating another', async () => {
    mockFindThread.mockResolvedValue({ id: 11, business_id: 'business-1' });
    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  it('creates, links, and contextualizes a recommendation thread for an Admin', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);
    expect(response.status).toBe(201);
    expect(mockGetOrCreate).toHaveBeenCalledWith('business-1', 42, {
      title: 'Plan: profitable growth opportunity', createdBy: 7,
      systemContent: expect.stringContaining('does not authorize approval or execution'),
      systemMessage: { recommendationId: 42, contextType: 'recommendation_link' },
    });
  });

  it('does not create a thread for a recommendation outside the tenant', async () => {
    mockGetRecommendation.mockResolvedValue(null);
    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);
    expect(response.status).toBe(404);
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });
});