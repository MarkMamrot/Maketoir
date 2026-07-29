import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockRollback } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockRollback: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightRollbackService', () => ({
  ForesightRollbackService: { rollback: mockRollback },
}));

import { POST } from '../route';

const fingerprint = 'b'.repeat(64);
function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/recommendations/42/rollback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/foresight/marketing/recommendations/[id]/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockRollback.mockResolvedValue({
      execution: { id: 10, state: 'succeeded', compensates_execution_id: 9 },
      idempotentReplay: false, mutationSubmitted: true,
    });
  });

  it('requires Admin tier before rollback', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(request({}), { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mockRollback).not.toHaveBeenCalled();
  });

  it('requires the exact rollback confirmation phrase', async () => {
    const response = await POST(request({
      executionId: 9, proposalHash: 'proposal', confirmationFingerprint: fingerprint,
      confirmationPhrase: 'yes',
    }), { params: { id: '42' } });
    expect(response.status).toBe(400);
    expect(mockRollback).not.toHaveBeenCalled();
  });

  it('uses tenant and actor identity only from the Admin session', async () => {
    const response = await POST(request({
      executionId: 9, proposalHash: 'proposal', confirmationFingerprint: fingerprint,
      confirmationPhrase: 'REVERSE GOOGLE BUDGET CHANGES', businessId: 'attacker-business',
    }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockRollback).toHaveBeenCalledWith({
      businessId: 'business-1', recommendationId: 42, originalExecutionId: 9,
      actorId: 7, proposalHash: 'proposal', confirmationFingerprint: fingerprint,
    });
  });

  it('returns conflict when the live rollback preflight is stale', async () => {
    mockRollback.mockRejectedValue(new Error('Live Google Ads settings changed; run rollback preflight again.'));
    const response = await POST(request({
      executionId: 9, proposalHash: 'proposal', confirmationFingerprint: fingerprint,
      confirmationPhrase: 'REVERSE GOOGLE BUDGET CHANGES',
    }), { params: { id: '42' } });
    expect(response.status).toBe(409);
  });
});