import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockRequestApproval, mockDecide, mockAttest } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockRequestApproval: vi.fn(),
  mockDecide: vi.fn(),
  mockAttest: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: vi.fn(async (_businessId, callback) => callback()),
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({
  DEFAULT_BUSINESS_TIME_ZONE: 'Australia/Sydney',
  getBusinessTimeZone: vi.fn().mockResolvedValue('Australia/Sydney'),
}));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: {
    requestRecommendationApproval: mockRequestApproval,
    decideRecommendation: mockDecide,
    attestRecommendationImplementation: mockAttest,
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
      action: 'request_approval', proposalHash: 'hash-1', reasonCode: 'ready_for_review', note: 'Please review.',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockRequestApproval).toHaveBeenCalledWith(
      'business-1', 42, 7, 'hash-1', 'ready_for_review', 'Please review.',
    );
  });

  it('records approval only through the pending-decision method', async () => {
    const response = await PATCH(request({
      action: 'approve', proposalHash: 'hash-1', reasonCode: 'within_guardrails', note: 'Approved.',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockDecide).toHaveBeenCalledWith(
      'business-1', 42, 'approved', 7, 'hash-1', 'within_guardrails', 'Approved.',
    );
  });

  it('returns a conflict for stale hashes or invalid state transitions', async () => {
    mockDecide.mockRejectedValue(new Error('Foresight proposal changed; refresh before approving.'));

    const response = await PATCH(request({
      action: 'approve', proposalHash: 'stale', reasonCode: 'evidence_supports_action',
    }), { params: { id: '42' } });

    expect(response.status).toBe(409);
  });

  it('records external implementation with tenant, actor, hash, date, and required detail', async () => {
    const response = await PATCH(request({
      action: 'attest_implemented',
      proposalHash: 'hash-1',
      implementedOn: '2026-07-29',
      note: 'Reduced Meta Prospecting daily budget from $100 to $92.',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockAttest).toHaveBeenCalledWith(
      'business-1',
      42,
      7,
      'hash-1',
      '2026-07-29',
      'Reduced Meta Prospecting daily budget from $100 to $92.',
    );
  });

  it('rejects future or undocumented implementation attestations', async () => {
    const future = await PATCH(request({
      action: 'attest_implemented', proposalHash: 'hash-1', implementedOn: '2099-01-01', note: 'Changed.',
    }), { params: { id: '42' } });
    const empty = await PATCH(request({
      action: 'attest_implemented', proposalHash: 'hash-1', implementedOn: '2026-07-29', note: '',
    }), { params: { id: '42' } });
    const impossible = await PATCH(request({
      action: 'attest_implemented', proposalHash: 'hash-1', implementedOn: '2026-02-30', note: 'Changed.',
    }), { params: { id: '42' } });

    expect(future.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(impossible.status).toBe(400);
    expect(mockAttest).not.toHaveBeenCalled();
  });

  it('requires an action-specific structured reason', async () => {
    const response = await PATCH(request({
      action: 'reject', proposalHash: 'hash-1', reasonCode: 'within_guardrails',
    }), { params: { id: '42' } });

    expect(response.status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });
});