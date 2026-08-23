import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireSuperAdminTier: vi.fn(), query: vi.fn(), reportRuntimeIssue: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.requireSuperAdminTier }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

describe('admin prospect leads route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSuperAdminTier.mockReturnValue({ user: { userId: 7 } });
  });

  it('requires SuperAdmin before schema inspection', async () => {
    mocks.requireSuperAdminTier.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await GET(new Request('http://localhost/api/admin/prospect-leads'));
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects invalid dates before schema inspection', async () => {
    const response = await GET(new Request('http://localhost/api/admin/prospect-leads?from=2026-02-30'));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects assignee filtering when the schema has no assignment column', async () => {
    mocks.query.mockResolvedValueOnce([{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'status' }]);
    const response = await GET(new Request('http://localhost/api/admin/prospect-leads?assignee=2'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not available') });
  });

  it('reports schema failures without including prospect search text', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(new Request('http://localhost/api/admin/prospect-leads?search=person@example.com'));
    expect(response.status).toBe(500);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'list_prospect_leads', context: expect.objectContaining({ has_search: true }),
    }));
    expect(JSON.stringify(mocks.reportRuntimeIssue.mock.calls[0][0])).not.toContain('person@example.com');
  });
});