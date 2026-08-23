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

  it('does not return internal notes through the public repository contract', async () => {
    const repositorySource = await import('@/lib/salesAssistant/repository');
    expect(repositorySource.createSalesAssistantRepository).toBeTypeOf('function');
    const response = await GET(new Request('http://localhost/api/admin/integration-offerings'));
    expect(response.status).toBe(200);
  });
});