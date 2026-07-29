import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockRequestApproval, mockDecide } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockRequestApproval: vi.fn(),
  mockDecide: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: {
    requestRecommendationApproval: mockRequestApproval,
    decideRecommendation: mockDecide,
  },
}));

import { PATCH } from '../route';

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/recommendations/42', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/foresight/marketing/recommendations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
  });

  it('requires Admin tier before changing recommendation state', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });

    const response = await PATCH(request({ action: 'approve', proposalHash: 'hash-1' }), { params: { id: '42' } });

    expect(response.status).toBe(403);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('requests approval with tenant, actor, proposal hash, and note', async () => {
    const response = await PATCH(request({
      action: 'request_approval', proposalHash: 'hash-1', note: 'Please review.',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockRequestApproval).toHaveBeenCalledWith(
      'business-1', 42, 7, 'hash-1', 'Please review.',
    );
  });

  it('records approval only through the pending-decision method', async () => {
    const response = await PATCH(request({
      action: 'approve', proposalHash: 'hash-1', note: 'Approved.',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockDecide).toHaveBeenCalledWith(
      'business-1', 42, 'approved', 7, 'hash-1', 'Approved.',
    );
  });

  it('returns a conflict for stale hashes or invalid state transitions', async () => {
    mockDecide.mockRejectedValue(new Error('Foresight proposal changed; refresh before approving.'));

    const response = await PATCH(request({ action: 'approve', proposalHash: 'stale' }), { params: { id: '42' } });

    expect(response.status).toBe(409);
  });
});