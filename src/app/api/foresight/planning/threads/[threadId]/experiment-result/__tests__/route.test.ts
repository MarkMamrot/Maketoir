import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session, tier, getForThread, latestReview, review } = vi.hoisted(() => ({
  session: vi.fn(), tier: vi.fn(), getForThread: vi.fn(), latestReview: vi.fn(), review: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: session, requireAdminTier: tier }));
vi.mock('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository')>();
  return { CampaignExperimentResultTransitionError: actual.CampaignExperimentResultTransitionError,
    ForesightCampaignExperimentResultRepository: { getForThread, latestReview, review } };
});

import { GET, POST } from '../route';

const context = { params: { threadId: '12' } };
const hash = 'c'.repeat(64);
const result = { id: 77, experiment_version_id: 55, experiment_hash: hash, launch_id: 66 };

function post(body: Record<string, unknown>) {
  return new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('/api/foresight/planning/threads/[threadId]/experiment-result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    tier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    getForThread.mockResolvedValue(result);
    latestReview.mockResolvedValue({ result_id: 77, experiment_version_id: 55, experiment_hash: hash, launch_id: 66, action: 'acknowledged' });
    review.mockResolvedValue(88);
  });

  it('returns only a review matching the exact result identity', async () => {
    const response = await GET(new Request('http://localhost'), context);
    expect(await response.json()).toMatchObject({ result: { id: 77 }, review: { action: 'acknowledged' } });
    latestReview.mockResolvedValue({ result_id: 76, experiment_version_id: 55, experiment_hash: hash, launch_id: 66, action: 'acknowledged' });
    const staleResponse = await GET(new Request('http://localhost'), context);
    expect((await staleResponse.json()).review).toBeNull();
  });

  it('records human acknowledgement with the session tenant and actor', async () => {
    const response = await POST(post({ resultId: 77, experimentVersionId: 55, experimentHash: hash, launchId: 66, action: 'acknowledged', note: '' }), context);
    expect(response.status).toBe(200);
    expect(review).toHaveBeenCalledWith('business-1', 12, {
      resultId: 77, experimentVersionId: 55, experimentHash: hash, launchId: 66,
      action: 'acknowledged', actorId: 7, note: '',
    });
  });

  it('rejects incomplete identity and unsupported actions before repository access', async () => {
    expect((await POST(post({ resultId: 77, action: 'acknowledged' }), context)).status).toBe(400);
    expect((await POST(post({ resultId: 77, experimentVersionId: 55, experimentHash: hash, launchId: 66, action: 'accepted' }), context)).status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });

  it('returns a governed validation response when rejection lacks a note', async () => {
    const { CampaignExperimentResultTransitionError } = await import('@/lib/foresight/repositories/ForesightCampaignExperimentResultRepository');
    review.mockRejectedValue(new CampaignExperimentResultTransitionError('A note is required when rejecting an experiment conclusion.'));
    const response = await POST(post({ resultId: 77, experimentVersionId: 55, experimentHash: hash, launchId: 66, action: 'rejected', note: '' }), context);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EXPERIMENT_CONCLUSION_REVIEW_REJECTED' });
  });
});
