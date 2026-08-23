import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireSuperAdminTier: vi.fn(), query: vi.fn(), reportRuntimeIssue: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.requireSuperAdminTier }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('admin prospect insights route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSuperAdminTier.mockReturnValue({ user: { userId: 7 } });
    mocks.query.mockResolvedValue([]);
  });

  it('requires SuperAdmin before aggregation queries', async () => {
    mocks.requireSuperAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await GET(new Request('http://localhost/api/admin/prospect-insights'));
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects invalid date filters', async () => {
    const response = await GET(new Request('http://localhost/api/admin/prospect-insights?to=2026-13-01'));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns an empty, well-defined funnel', async () => {
    const response = await GET(new Request('http://localhost/api/admin/prospect-insights'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      funnel: { totalConversations: 0, totalLeads: 0, conversionRate: 0 },
    });
    expect(mocks.query).toHaveBeenCalledTimes(8);
  });
});