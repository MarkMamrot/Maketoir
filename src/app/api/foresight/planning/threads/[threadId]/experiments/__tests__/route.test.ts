import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session, tier, latest, latestReview, generate, review } = vi.hoisted(() => ({ session: vi.fn(), tier: vi.fn(), latest: vi.fn(), latestReview: vi.fn(), generate: vi.fn(), review: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({ createGeminiPlannerModelGateway: vi.fn(() => ({ generateJson: vi.fn() })) }));
vi.mock('@/lib/foresight/assistant/ForesightCampaignExperimentService', () => ({ ForesightCampaignExperimentService: { generate } }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentRepository')>();
  return { CampaignExperimentTransitionError: actual.CampaignExperimentTransitionError, ForesightCampaignExperimentRepository: { latest, latestReview, review } };
});

import { CampaignExperimentTransitionError } from '@/lib/foresight/repositories/ForesightCampaignExperimentRepository';
import { GET, POST } from '../route';
const context = { params: { threadId: '12' } };

describe('/api/foresight/planning/threads/[threadId]/experiments', () => {
  beforeEach(() => {
    vi.clearAllMocks(); process.env.GEMINI_API_KEY = 'test-key'; delete process.env.FORESIGHT_PLANNER_MODEL;
    session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } }); tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    latest.mockResolvedValue(null); latestReview.mockResolvedValue(null); generate.mockResolvedValue({ id: 55 }); review.mockResolvedValue(56);
  });
  it('reads only through the session tenant', async () => {
    expect((await GET(new Request('http://localhost'), context)).status).toBe(200);
    expect(latest).toHaveBeenCalledWith('business-1', 12); expect(latestReview).toHaveBeenCalledWith('business-1', 12);
  });
  it('generates using Admin tenant and server-controlled model identity', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'generate', modelId: 'attacker-model' }) }), context);
    expect(response.status).toBe(201); expect(generate).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', threadId: 12, actorUserId: 7, modelId: 'gemini-2.5-flash' }));
  });
  it('returns expected transition failures as 422', async () => {
    review.mockRejectedValue(new CampaignExperimentTransitionError('Exact experiment required.'));
    const response = await POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'review', experimentVersionId: 55, experimentHash: 'b'.repeat(64), action: 'accepted' }) }), context);
    expect(response.status).toBe(422); expect((await response.json()).code).toBe('EXPERIMENT_REJECTED');
  });
});