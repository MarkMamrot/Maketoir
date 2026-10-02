import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), reconcile: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/channels/shopifyFulfilmentReconciliation', () => ({
  reconcileShopifyFulfilmentsForChannel: mocks.reconcile,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { POST } from '../route';

const request = new Request('http://localhost/api/ims/channels/instance-1/shopify/reconcile-fulfilments', { method: 'POST' });

function result(overrides: Record<string, unknown> = {}) {
  return {
    channelInstanceId: 'instance-1',
    windowStart: '2026-09-30T12:00:00.000Z',
    windowEnd: '2026-10-02T00:00:00.000Z',
    disabled: false,
    scanned: 2,
    providerFulfilled: 1,
    repaired: [{ salesOrderId: 44, shopifyOrderId: '1001' }],
    alreadyCurrent: 0,
    missingLocal: [],
    reviewRequired: [],
    invalidProviderRows: 0,
    failures: [],
    ...overrides,
  };
}

describe('POST manual Shopify fulfilment reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mocks.reconcile.mockResolvedValue(result());
    mocks.report.mockResolvedValue(1);
  });

  afterEach(() => vi.useRealTimers());

  it('runs the exact storefront over 36 hours and reports repaired drift', async () => {
    const response = await POST(request, { params: { id: 'instance-1' } });

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      windowStart: '2026-09-30T12:00:00.000Z', windowEnd: '2026-10-02T00:00:00.000Z',
    });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'fulfilment_reconciliation_backfill',
      context: expect.objectContaining({ trigger: 'manual', salesOrderIds: [44] }),
    }));
    expect(await response.json()).toMatchObject({ success: true, repaired: [{ salesOrderId: 44 }] });
  });

  it('blocks read-only accounts before reconciliation', async () => {
    mocks.session.mockResolvedValue({ businessId: 'business-1', tier: 'Advisor' });

    const response = await POST(request, { params: { id: 'instance-1' } });

    expect(response.status).toBe(403);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('returns partial results and records unresolved drift', async () => {
    mocks.reconcile.mockResolvedValue(result({
      repaired: [],
      reviewRequired: [{ salesOrderId: 45, shopifyOrderId: '1002', status: 'cancelled' }],
    }));

    const response = await POST(request, { params: { id: 'instance-1' } });

    expect(response.status).toBe(207);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'fulfilment_reconciliation_failed' }));
    expect(await response.json()).toMatchObject({ success: false, reviewRequired: [{ salesOrderId: 45 }] });
  });
});