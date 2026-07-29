import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockExecute } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightExecutionService', () => ({
  ForesightExecutionService: { execute: mockExecute },
}));

import { POST } from '../route';

const fingerprint = 'a'.repeat(64);

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/recommendations/42/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/foresight/marketing/recommendations/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockExecute.mockResolvedValue({
      execution: { id: 9, state: 'succeeded' },
      idempotentReplay: false,
      mutationSubmitted: true,
    });
  });

  it('requires Admin tier before any execution call', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(request({}), { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('requires the exact confirmation phrase and fingerprint', async () => {
    const response = await POST(request({
      proposalHash: 'proposal', confirmationFingerprint: fingerprint, confirmationPhrase: 'yes',
    }), { params: { id: '42' } });
    expect(response.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('derives tenant and actor from the Admin session', async () => {
    const response = await POST(request({
      proposalHash: 'proposal',
      confirmationFingerprint: fingerprint,
      confirmationPhrase: 'APPLY GOOGLE BUDGET CHANGES',
      businessId: 'attacker-business',
    }), { params: { id: '42' } });

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith({
      businessId: 'business-1', recommendationId: 42, actorId: 7,
      proposalHash: 'proposal', confirmationFingerprint: fingerprint,
    });
  });

  it('returns conflict when fresh live settings differ from confirmation', async () => {
    mockExecute.mockRejectedValue(new Error('Live Google Ads settings changed; run preflight again.'));
    const response = await POST(request({
      proposalHash: 'proposal', confirmationFingerprint: fingerprint,
      confirmationPhrase: 'APPLY GOOGLE BUDGET CHANGES',
    }), { params: { id: '42' } });
    expect(response.status).toBe(409);
  });
});