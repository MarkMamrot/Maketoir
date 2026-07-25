import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockPostCogsPeriod } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockPostCogsPeriod: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/XeroCogsService', () => ({ postCogsPeriod: mockPostCogsPeriod }));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/xero/cogs/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/xero/cogs/post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { id: 'u1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockPostCogsPeriod.mockResolvedValue({ outcome: 'posted', runId: 1, xeroId: 'xero-1' });
  });

  it('posts only a completed calendar period', async () => {
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'weekly' }));
    expect(response.status).toBe(200);
    expect(mockPostCogsPeriod).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      period: expect.objectContaining({ frequency: 'weekly' }),
    }));
  });

  it('returns 422 when data quality blocks posting', async () => {
    mockPostCogsPeriod.mockResolvedValueOnce({ outcome: 'blocked', reason: 'uncosted_movements' });
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    expect(response.status).toBe(422);
  });

  it('returns 202 for an ambiguous Xero outcome', async () => {
    mockPostCogsPeriod.mockResolvedValueOnce({ outcome: 'unknown', runId: 2, error: 'timed out' });
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    expect(response.status).toBe(202);
  });
});