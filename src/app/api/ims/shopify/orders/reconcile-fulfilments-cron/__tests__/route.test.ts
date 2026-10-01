import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), run: vi.fn(), reconcile: vi.fn(), report: vi.fn(), capabilities: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/channels/shopifyFulfilmentReconciliation', () => ({
  reconcileShopifyFulfilmentsForChannel: mocks.reconcile,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/businessOperations', () => ({ getOnlineChannelCapabilities: mocks.capabilities }));

import { POST } from '../route';

function request(secret = 'cron-secret') {
  return new Request('http://localhost/api/ims/shopify/orders/reconcile-fulfilments-cron', {
    method: 'POST', headers: { 'x-cron-secret': secret },
  });
}

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

describe('POST Shopify fulfilment reconciliation cron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    mocks.query.mockResolvedValue([{ business_id: 'business-1', channel_instance_id: 'instance-1' }]);
    mocks.run.mockImplementation(async (_businessId: string, callback: () => Promise<unknown>) => callback());
    mocks.reconcile.mockResolvedValue(result());
    mocks.report.mockResolvedValue(1);
    mocks.capabilities.mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
  });

  it('binds each exact tenant to one fixed 36-hour window and reports successful repairs', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][0]).toContain("instance.provider = 'shopify'");
    expect(mocks.query.mock.calls[0][0]).toContain('automation_paused');
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: 'business-1',
      channelInstanceId: 'instance-1',
      windowStart: '2026-09-30T12:00:00.000Z',
      windowEnd: '2026-10-02T00:00:00.000Z',
    });
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      operation: 'fulfilment_reconciliation_backfill',
      severity: 'warning',
      context: expect.objectContaining({ repairedCount: 1, salesOrderIds: [44], shopifyOrderIds: ['1001'] }),
    }));
    expect(await response.json()).toMatchObject({ success: true, repaired: 1, channels: 1 });
  });

  it('returns 207 and reports unresolved order drift separately', async () => {
    mocks.reconcile.mockResolvedValue(result({
      repaired: [],
      failures: [{ salesOrderId: 45, shopifyOrderId: '1002', error: 'Stock is not covered.' }],
    }));

    const response = await POST(request());

    expect(response.status).toBe(207);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'fulfilment_reconciliation_failed',
      context: expect.objectContaining({ failures: [expect.objectContaining({ salesOrderId: 45 })] }),
    }));
    expect(await response.json()).toMatchObject({ success: false, failedOrders: 1 });
  });

  it('rejects requests without the cron secret', async () => {
    const response = await POST(request('wrong-secret'));
    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('skips intentionally disabled Shopify businesses without entering tenant work', async () => {
    mocks.capabilities.mockResolvedValue({ shopifyEnabled: false, nativeShopEnabled: false });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ success: true, repaired: 0 });
  });
});