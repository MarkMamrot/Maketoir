import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockAssertBusinessAccess, mockSyncOnlineDailySalesDay, mockSyncAccess, readiness, enqueue, report, imsExecute, imsQuery } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockSyncOnlineDailySalesDay: vi.fn(),
  mockSyncAccess: vi.fn(),
  readiness: vi.fn(),
  enqueue: vi.fn(),
  report: vi.fn(),
  imsExecute: vi.fn(),
  imsQuery: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute, imsQuery }));
vi.mock('@/lib/xero/onlineDailyAccountingRecovery', () => ({ getOnlineDailyAccountingReadiness: readiness }));
vi.mock('@/lib/channels/onlineSyncJobs', () => ({ enqueueOnlineSyncJob: enqueue }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: vi.fn().mockResolvedValue(undefined) }));
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
    readiness.mockResolvedValue({ active: false, ready: false, reason: 'legacy' });
    enqueue.mockResolvedValue(undefined);
    report.mockResolvedValue(null);
    imsExecute.mockResolvedValue({ affectedRows: 1 });
    imsQuery.mockResolvedValue([{ status: 'pending' }]);
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

  it.each(['Admin', 'Advisor'])('queues ready cutover accounting for %s without imports or inline posting', async tier => {
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1', tier } });
    readiness.mockResolvedValue({ active: true, ready: true, reason: 'ready', provider: 'shopify', requiredThrough: '2026-09-04T00:00:00Z' });
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    try {
      const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
        method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
      }));
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ success: false, status: 'queued' });
      expect(enqueue).toHaveBeenCalledWith({
        businessId: 'biz-1', channelInstanceId: 'shop-1', provider: 'shopify',
        operation: 'online_daily_accounting', operationKey: '2026-09-03', payload: { kind: 'daily_accounting', date: '2026-09-03', manual: true },
      });
      expect(providerFetch).not.toHaveBeenCalled();
      expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('cannot override an incomplete baseline with an administrator request', async () => {
    readiness.mockResolvedValue({ active: true, ready: false, reason: 'baseline_incomplete', provider: 'shopify' });
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1', override: true }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, status: 'blocked', reason: 'baseline_incomplete' });
    expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
  });

  it('keeps native cutover accounting independent from Shopify imports', async () => {
    readiness.mockResolvedValue({ active: true, ready: true, reason: 'ready', provider: 'native_shop' });
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'native-1' }),
    }));
    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ provider: 'native_shop', channelInstanceId: 'native-1' }));
    expect(mockSyncOnlineDailySalesDay).not.toHaveBeenCalled();
  });

  it('does not requeue a posted day requiring review', async () => {
    readiness.mockResolvedValue({ active: true, ready: false, reason: 'posted_day_changed', reviewRequired: true, provider: 'shopify' });
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 'review' });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('joins a processing canonical date job without rewriting its execution policy or lease', async () => {
    readiness.mockResolvedValue({ active: true, ready: true, reason: 'ready', provider: 'shopify' });
    imsQuery.mockResolvedValueOnce([{ status: 'processing' }]);
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'joined', queued: true });
    expect(imsExecute.mock.calls[0][0]).toContain("job.status <> 'processing'");
    expect(readiness).toHaveBeenCalledWith(expect.objectContaining({ manual: true }));
  });
  it('never claims queued when control changed and no activated canonical job exists', async () => {
    readiness.mockResolvedValue({ active: true, ready: true, reason: 'ready', provider: 'shopify' });
    imsQuery.mockResolvedValueOnce([]);
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-09-03', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 'blocked', queued: false, reason: 'accounting_job_unavailable' });
  });

  it('rejects invalid calendar dates before readiness or provider work', async () => {
    const response = await POST(new Request('http://localhost/api/xero/sync/daily-sales', {
      method: 'POST', body: JSON.stringify({ databaseId: 'biz-1', date: '2026-02-30', channel: 'online', channelInstanceId: 'shop-1' }),
    }));
    expect(response.status).toBe(400);
    expect(readiness).not.toHaveBeenCalled();
  });
});