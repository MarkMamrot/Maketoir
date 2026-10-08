import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockPostCogsPeriod, mockRunImsForBusiness, mockGetBusinessTimeZone, mockAssertXeroPostingEnabled, mockSyncAccess, mockQuery } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockPostCogsPeriod: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetBusinessTimeZone: vi.fn(),
  mockAssertXeroPostingEnabled: vi.fn(),
  mockSyncAccess: vi.fn(),
  mockQuery: vi.fn(),
}));
vi.mock('@/lib/xero/advisorSyncAccess', () => ({ getXeroSyncAccessDenied: mockSyncAccess }));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/services/XeroCogsService', () => ({ postCogsPeriod: mockPostCogsPeriod }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: mockGetBusinessTimeZone }));
vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertXeroAccountingEnabled: vi.fn().mockResolvedValue(undefined),
  isXeroAccountingDisabledError: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/xero/postingPolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/xero/postingPolicy')>();
  return { ...actual, assertXeroPostingEnabled: mockAssertXeroPostingEnabled };
});

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
    mockAssertXeroPostingEnabled.mockResolvedValue(undefined);
    mockSyncAccess.mockResolvedValue(null);
    mockQuery.mockResolvedValue([{ reliable_from: '2020-01-01' }]);
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

  it('posts an explicitly selected completed historical period', async () => {
    const response = await POST(makeRequest({
      databaseId: 'biz-1',
      frequency: 'monthly',
      startDate: '2026-08-01',
      endDateExclusive: '2026-09-01',
    }));
    expect(response.status).toBe(200);
    expect(mockPostCogsPeriod).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      period: expect.objectContaining({ startDate: '2026-08-01', endDateExclusive: '2026-09-01', journalDate: '2026-08-31' }),
    }));
  });

  it('rejects misaligned, incomplete, and pre-reliable historical periods', async () => {
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly', startDate: '2026-08-01', endDateExclusive: '2026-08-15' }))).status).toBe(400);
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly', startDate: '2026-10-01', endDateExclusive: '2026-11-01' }))).status).toBe(400);
    mockQuery.mockResolvedValueOnce([{ reliable_from: '2026-09-01' }]);
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly', startDate: '2026-08-01', endDateExclusive: '2026-09-01' }))).status).toBe(400);
  });

  it('blocks disabled Advisors before calculating or posting', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    mockSyncAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }))).status).toBe(403);
    expect(mockPostCogsPeriod).not.toHaveBeenCalled();
  });

  it('allows enabled Advisors to post a completed period', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }))).status).toBe(200);
    expect(mockPostCogsPeriod).toHaveBeenCalledOnce();
  });

  it('keeps valuation overrides blocked for enabled Advisors', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    expect((await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly', overrideReason: 'Override' }))).status).toBe(403);
    expect(mockPostCogsPeriod).not.toHaveBeenCalled();
  });

  it('returns 202 for an ambiguous Xero outcome', async () => {
    mockPostCogsPeriod.mockResolvedValueOnce({ outcome: 'unknown', runId: 2, error: 'timed out' });
    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    expect(response.status).toBe(202);
  });

  it('returns 423 without calculating or posting when Xero posting is paused', async () => {
    const { XeroPostingDisabledError } = await import('@/lib/xero/postingPolicy');
    mockAssertXeroPostingEnabled.mockRejectedValueOnce(new XeroPostingDisabledError());

    const response = await POST(makeRequest({ databaseId: 'biz-1', frequency: 'monthly' }));
    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ code: 'xero_posting_disabled' });
    expect(mockRunImsForBusiness).not.toHaveBeenCalled();
    expect(mockPostCogsPeriod).not.toHaveBeenCalled();
  });
});