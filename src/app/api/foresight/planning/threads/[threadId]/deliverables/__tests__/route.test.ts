import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), tier: vi.fn(), generate: vi.fn(), createGateway: vi.fn(), latest: vi.fn(), latestReview: vi.fn(), review: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, requireAdminTier: mocks.tier }));
vi.mock('@/lib/foresight/assistant/ForesightDeliverableService', () => ({
  FORESIGHT_DELIVERABLE_CHANNELS: ['campaign_brief', 'meta', 'google_ads', 'klaviyo'],
  ForesightDeliverableService: { generate: mocks.generate },
}));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({ createGeminiPlannerModelGateway: mocks.createGateway }));
vi.mock('@/lib/foresight/repositories/ForesightDeliverableRepository', () => ({
  DeliverableTransitionError: class DeliverableTransitionError extends Error {},
  ForesightDeliverableRepository: { latest: mocks.latest, latestReview: mocks.latestReview, review: mocks.review },
}));

import { GET, POST } from '../route';

describe('/api/foresight/planning/threads/[threadId]/deliverables', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    mocks.session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mocks.tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mocks.latest.mockResolvedValue(null);
    mocks.latestReview.mockResolvedValue(null);
    mocks.generate.mockResolvedValue({ id: 80, version: 1 });
    mocks.review.mockResolvedValue(90);
  });
  afterEach(() => {
    if (originalKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  });

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/foresight/planning/threads/12/deliverables', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('reads the latest package through session tenancy', async () => {
    expect((await GET(new Request('http://localhost'), { params: { threadId: '12' } })).status).toBe(200);
    expect(mocks.latest).toHaveBeenCalledWith('business-1', 12);
  });

  it('generates only supported channels with the server-controlled model', async () => {
    const response = await POST(request({ operation: 'generate', channels: ['meta', 'delete_campaign'] }), { params: { threadId: '12' } });
    expect(response.status).toBe(201);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', threadId: 12, actorUserId: 7, channels: ['meta'],
    }));
  });

  it('reviews only an exact package hash', async () => {
    const response = await POST(request({
      operation: 'review', deliverableVersionId: 80, documentHash: 'b'.repeat(64), action: 'accepted',
    }), { params: { threadId: '12' } });
    expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith('business-1', 12, {
      deliverableVersionId: 80, documentHash: 'b'.repeat(64), action: 'accepted', actorId: 7, note: null,
    });
  });
});