import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockReviewPlan } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockReviewPlan: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockSession }));
vi.mock('@/lib/foresight/repositories/ForesightPlanningRepository', () => ({
  PlanningThreadConflictError: class PlanningThreadConflictError extends Error {},
  PlanReviewTransitionError: class PlanReviewTransitionError extends Error {},
  ForesightPlanningRepository: { reviewPlan: mockReviewPlan },
}));

import { POST } from '../route';

describe('/api/foresight/planning/threads/[threadId]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockReviewPlan.mockResolvedValue({ eventId: 70, threadRevision: 5, threadState: 'locked_for_approval' });
  });

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/foresight/planning/threads/12/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  const valid = {
    expectedRevision: 4, planVersionId: 41, planHash: 'a'.repeat(64), action: 'submitted',
  };

  it('uses Admin session tenancy and the exact plan identity', async () => {
    const response = await POST(request({ ...valid, businessId: 'attacker' }), { params: { threadId: '12' } });
    expect(response.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalledWith('business-1', 12, 4, {
      planVersionId: 41, planHash: 'a'.repeat(64), action: 'submitted', actorId: 7, note: null,
    });
  });

  it('rejects malformed plan identity before repository access', async () => {
    const response = await POST(request({ ...valid, planHash: 'short' }), { params: { threadId: '12' } });
    expect(response.status).toBe(400);
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('returns conflict and expected transition rejection statuses', async () => {
    const repository = await import('@/lib/foresight/repositories/ForesightPlanningRepository');
    mockReviewPlan.mockRejectedValueOnce(new repository.PlanningThreadConflictError());
    expect((await POST(request(valid), { params: { threadId: '12' } })).status).toBe(409);

    mockReviewPlan.mockRejectedValueOnce(new repository.PlanReviewTransitionError('Passing validation required.'));
    const rejected = await POST(request(valid), { params: { threadId: '12' } });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({ code: 'PLAN_REVIEW_REJECTED' });
  });
});