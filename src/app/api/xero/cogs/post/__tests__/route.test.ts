import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockPostCogsPeriod, mockRunImsForBusiness, mockGetBusinessTimeZone } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockPostCogsPeriod: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/XeroCogsService', () => ({ postCogsPeriod: mockPostCogsPeriod }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));

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
    mockGetBusinessTimeZone.mockResolvedValue('Australia/Sydney');
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
  });

  it('posts only a completed calendar period', async () => {
    let tenantContextActive = false;
    mockRunImsForBusiness.mockImplementationOnce(async (_businessId, callback) => {
      tenantContextActive = true;
      try {
        return await callback();
      } finally {
        tenantContextActive = false;
      }
    });
    mockPostCogsPeriod.mockImplementationOnce(async () => {
      expect(tenantContextActive).toBe(true);
      return { outcome: 'posted', runId: 1, xeroId: 'xero-1' };
    });

    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'weekly' }));
    expect(response.status).toBe(200);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
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