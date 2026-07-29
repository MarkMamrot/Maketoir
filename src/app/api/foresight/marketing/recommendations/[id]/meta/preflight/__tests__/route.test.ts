import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockPreflight } = vi.hoisted(() => ({
  mockRequireAdminTier: vi.fn(), mockPreflight: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightMetaExecutionPreflightService', () => ({
  ForesightMetaExecutionPreflightService: { preflight: mockPreflight },
}));

import { POST } from '../route';

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/foresight/marketing/recommendations/42/meta/preflight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/foresight/marketing/recommendations/[id]/meta/preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1' } });
    mockPreflight.mockResolvedValue({ mode: 'read_only_meta_preflight', executable: false, ready: true });
  });

  it('requires Admin tier before reading Meta settings', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(request({ proposalHash: 'proposal' }), { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mockPreflight).not.toHaveBeenCalled();
  });

  it('derives the tenant from the Admin session', async () => {
    const response = await POST(request({ proposalHash: 'proposal', businessId: 'attacker' }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockPreflight).toHaveBeenCalledWith('business-1', 42, 'proposal');
  });

  it('requires a proposal hash', async () => {
    const response = await POST(request({}), { params: { id: '42' } });
    expect(response.status).toBe(400);
    expect(mockPreflight).not.toHaveBeenCalled();
  });
});