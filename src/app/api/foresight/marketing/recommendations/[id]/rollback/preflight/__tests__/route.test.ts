import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockPreflight } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(),
  mockPreflight: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightRollbackPreflightService', () => ({
  ForesightRollbackPreflightService: { preflight: mockPreflight },
}));

import { POST } from '../route';

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/recommendations/42/rollback/preflight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/foresight/marketing/recommendations/[id]/rollback/preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockPreflight.mockResolvedValue({ ready: true, changes: [] });
  });

  it('requires Admin tier before reading rollback readiness', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(request({}), { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mockPreflight).not.toHaveBeenCalled();
  });

  it('derives tenant identity and validates the original execution id', async () => {
    const response = await POST(request({ executionId: 9, proposalHash: 'proposal' }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockPreflight).toHaveBeenCalledWith('business-1', 42, 9, 'proposal');

    const invalid = await POST(request({ executionId: 0, proposalHash: 'proposal' }), { params: { id: '42' } });
    expect(invalid.status).toBe(400);
  });
});