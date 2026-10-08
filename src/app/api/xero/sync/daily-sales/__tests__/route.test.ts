import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockSyncOnlineDailySalesDay, mockSyncAccess } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockSyncOnlineDailySalesDay: vi.fn(),
  mockSyncAccess: vi.fn(),
}));
vi.mock('@/lib/xero/advisorSyncAccess', () => ({ getXeroSyncAccessDenied: mockSyncAccess }));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/lib/xero/onlineDailySalesSync', () => ({
  syncOnlineDailySalesDay: mockSyncOnlineDailySalesDay,
}));

import { POST } from '../route';

describe('POST /api/xero/sync/daily-sales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockSyncAccess.mockResolvedValue(null);
  });

  it('blocks disabled Advisors before importing or posting', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    mockSyncAccess.mockResolvedValue(NextResponse.json({ error: 'disabled' }, { status: 403 }));
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(403);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lets enabled Advisors sync saved sales without a Shopify import', async () => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier: 'Advisor' } });
    mockSyncOnlineDailySalesDay.mockResolvedValue({ xeroId: 'invoice-1', totalSales: 50, totalTax: 4.55 });
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(200);
    expect(mockSyncOnlineDailySalesDay).toHaveBeenCalledWith('biz-1', '2026-09-03', 'shop-1');
    expect(providerFetch).not.toHaveBeenCalled();
    expect((await response.json()).preflightImport.attempted).toBe(false);
    vi.unstubAllGlobals();
  });

  it('rejects POS batches because POS revenue belongs to EOD reconciliation', async () => {
    const request = new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseId: 'biz-1', date: '2026-07-25', channel: 'pos' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('POS end-of-day reconciliation');
    expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
  });
});