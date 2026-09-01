import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session, tier, latest, latestReview, generate, review } = vi.hoisted(() => ({
  session: vi.fn(), tier: vi.fn(), latest: vi.fn(), latestReview: vi.fn(), generate: vi.fn(), review: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({ createGeminiPlannerModelGateway: vi.fn(() => ({ generateJson: vi.fn() })) }));
vi.mock('@/lib/foresight/assistant/ForesightCampaignLessonService', () => ({ ForesightCampaignLessonService: { generate } }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignLessonRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignLessonRepository')>();
  return { CampaignLessonTransitionError: actual.CampaignLessonTransitionError,
    ForesightCampaignLessonRepository: { latest, latestReview, review } };
});

import { CampaignLessonTransitionError } from '@/lib/foresight/repositories/ForesightCampaignLessonRepository';
import { GET, POST } from '../route';

const context = { params: { threadId: '12' } };

describe('/api/foresight/planning/threads/[threadId]/lessons', () => {
  beforeEach(() => {
    vi.clearAllMocks(); process.env.GEMINI_API_KEY = 'test-key';
    session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    latest.mockResolvedValue(null); latestReview.mockResolvedValue(null);
    generate.mockResolvedValue({ id: 101 }); review.mockResolvedValue(102);
  });

  it('reads the latest lesson only through the session tenant', async () => {
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200);
    expect(latest).toHaveBeenCalledWith('business-1', 12);
    expect(latestReview).toHaveBeenCalledWith('business-1', 12);
  });

  it('generates using Admin tenant and server-controlled model identity', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'generate', modelId: 'attacker-model' }) }), context);
    expect(response.status).toBe(201);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', threadId: 12, actorUserId: 7, modelId: 'gemini-3.7-flash' }));
  });

  it('returns expected lesson transition failures as 422', async () => {
    review.mockRejectedValue(new CampaignLessonTransitionError('Exact lesson required.'));
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'review', lessonVersionId: 101, lessonHash: 'a'.repeat(64), action: 'accepted' }) }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('LESSON_REJECTED');
  });
});