import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSuperAdminTier: vi.fn(),
  query: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.requireSuperAdminTier }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, getPool: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('admin integration offerings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSuperAdminTier.mockReturnValue({ user: { userId: 7 } });
    mocks.query.mockResolvedValue([]);
  });

  it('requires SuperAdmin before querying', async () => {
    mocks.requireSuperAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await GET(new Request('http://localhost/api/admin/integration-offerings'));
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects invalid filters before querying', async () => {
    const response = await GET(new Request('http://localhost/api/admin/integration-offerings?deliveryMode=custom'));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('reports list failures with safe filter context', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(new Request('http://localhost/api/admin/integration-offerings?search=private-name'));
    expect(response.status).toBe(500);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'list_integration_offerings',
      context: expect.objectContaining({ has_search: true }),
    }));
    expect(JSON.stringify(mocks.reportRuntimeIssue.mock.calls[0][0])).not.toContain('private-name');
  });
});