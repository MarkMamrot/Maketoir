import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockRequireAdminTier, mockEvaluate, mockList, mockListEvents } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockRequireAdminTier: vi.fn(),
  mockEvaluate: vi.fn(),
  mockList: vi.fn(),
  mockListEvents: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  requireAdminTier: mockRequireAdminTier,
}));
vi.mock('@/lib/foresight/ForesightRecommendationService', () => ({
  ForesightRecommendationService: { evaluatePaidMedia: mockEvaluate },
}));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: { listRecommendations: mockList, listRecommendationEvents: mockListEvents },
}));

import { GET, POST } from '../route';

describe('/api/foresight/marketing/recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1' } });
    mockEvaluate.mockResolvedValue({ recommendationCount: 0, recommendations: [] });
    mockList.mockResolvedValue([]);
    mockListEvents.mockResolvedValue([]);
  });

  it('evaluates only for the authenticated business', async () => {
    const response = await POST(new Request('http://localhost/api/foresight/marketing/recommendations', {
      method: 'POST',
      body: JSON.stringify({ through: '2026-07-28' }),
    }));

    expect(response.status).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith('business-1', '2026-07-28');
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
    expect(mockList).toHaveBeenCalledWith('business-1', ['shadow', 'pending_approval', 'approved']);
    expect(mockListEvents).toHaveBeenCalledWith('business-1', []);
  });
});