import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminTier, mockPreflight } = vi.hoisted(() => ({ mockRequireAdminTier: vi.fn(), mockPreflight: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mockRequireAdminTier }));
vi.mock('@/lib/foresight/ForesightMetaRollbackPreflightService', () => ({ ForesightMetaRollbackPreflightService: { preflight: mockPreflight } }));
import { POST } from '../route';

const request = (body: Record<string, unknown>) => new Request('http://localhost/meta/rollback/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST Meta rollback preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockPreflight.mockResolvedValue({ ready: true, changes: [] });
  });

  it('requires admin tier before reading receipt state', async () => {
    mockRequireAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(request({}), { params: { id: '42' } });
    expect(response.status).toBe(403);
    expect(mockPreflight).not.toHaveBeenCalled();
  });

  it('derives tenant identity and validates execution id', async () => {
    const response = await POST(request({ executionId: 19, proposalHash: 'proposal' }), { params: { id: '42' } });
    expect(response.status).toBe(200);
    expect(mockPreflight).toHaveBeenCalledWith('business-1', 42, 19, 'proposal');
    expect((await POST(request({ executionId: 0, proposalHash: 'proposal' }), { params: { id: '42' } })).status).toBe(400);
  });
});
