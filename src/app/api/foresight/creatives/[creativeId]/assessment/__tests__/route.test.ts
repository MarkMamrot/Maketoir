import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), tier: vi.fn(), get: vi.fn(), latest: vi.fn(), assess: vi.fn(), gateway: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session, requireAdminTier: mocks.tier }));
vi.mock('@/lib/foresight/repositories/ForesightCreativeRepository', () => ({
  ForesightCreativeRepository: { get: mocks.get, latestAssessment: mocks.latest },
}));
vi.mock('@/lib/foresight/creative/ForesightCreativeAssessmentService', () => ({
  ForesightCreativeAssessmentService: { assess: mocks.assess },
}));
vi.mock('@/lib/foresight/assistant/PlannerModelGateway', () => ({ createGeminiPlannerModelGateway: mocks.gateway }));

import { GET, POST } from '../route';
import { CreativeAssessmentValidationError } from '@/lib/foresight/creative/creativeAssessment';

const user = { businessId: 'business-1', userId: 7, tier: 'Admin' };
const context = { params: { creativeId: '44' } };

describe('creative assessment route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'server-key');
    vi.stubEnv('FORESIGHT_CREATIVE_MODEL', 'gemini-creative');
    mocks.session.mockReturnValue({ user });
    mocks.tier.mockReturnValue({ user });
    mocks.gateway.mockReturnValue({ generateJson: vi.fn() });
  });

  it('returns only a tenant-owned creative and its latest assessment', async () => {
    mocks.get.mockResolvedValue({ id: 44, business_id: 'business-1' });
    mocks.latest.mockResolvedValue({ id: 5, creative_id: 44 });

    const response = await GET(new Request('http://localhost'), context);

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith('business-1', 44);
    expect(mocks.latest).toHaveBeenCalledWith('business-1', 44);
  });

  it('does not disclose a creative outside the session tenant', async () => {
    mocks.get.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(404);
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('uses server-controlled tenant, actor, model, and gateway', async () => {
    mocks.assess.mockResolvedValue({ id: 5 });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ businessId: 'other', modelId: 'other' }) }), context);

    expect(response.status).toBe(201);
    expect(mocks.gateway).toHaveBeenCalledWith('server-key');
    expect(mocks.assess).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', creativeId: 44, actorUserId: 7, modelId: 'gemini-creative',
    }));
  });

  it('fails closed when Gemini is not configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);
    expect(response.status).toBe(503);
    expect(mocks.assess).not.toHaveBeenCalled();
  });

  it('returns bounded validation issues when the model output is invalid', async () => {
    mocks.assess.mockRejectedValue(new CreativeAssessmentValidationError([
      'assessment.confidence must be between 0 and 1.',
    ]));

    const response = await POST(new Request('http://localhost', { method: 'POST' }), context);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: 'The model returned an invalid creative assessment.',
      code: 'INVALID_CREATIVE_ASSESSMENT',
      issues: ['assessment.confidence must be between 0 and 1.'],
    });
  });
});
