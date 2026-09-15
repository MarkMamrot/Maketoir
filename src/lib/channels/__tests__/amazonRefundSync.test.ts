import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstance: vi.fn(), setCursor: vi.fn(), access: vi.fn(), list: vi.fn(), normalize: vi.fn(),
  importObservations: vi.fn(), reconcile: vi.fn(), report: vi.fn(),
  run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));
vi.mock('../channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, setAmazonRefundSyncCursorForBusiness: mocks.setCursor,
} }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('../amazonSpApi', () => ({ listAmazonFinancialTransactions: mocks.list }));
vi.mock('../amazonRefundObservation', () => ({ normalizeAmazonRefundTransactions: mocks.normalize }));
vi.mock('../amazonRefundImport', () => ({ importAmazonRefundObservations: mocks.importObservations }));
vi.mock('../amazonRefundReconciliation', () => ({ reconcileAmazonRefunds: mocks.reconcile }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { syncAmazonRefundsForChannel } from '../amazonRefundSync';

describe('syncAmazonRefundsForChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInstance.mockResolvedValue({ provider: 'amazon', settings: { refundsLastPostedAt: '2026-09-14T00:00:00Z' } });
    mocks.access.mockResolvedValue({ accessToken: 'access-token', sellerId: 'seller-1' });
    mocks.list
      .mockResolvedValueOnce({ transactions: [{ transactionId: 'tx-1' }], nextToken: 'next-1' })
      .mockResolvedValueOnce({ transactions: [{ transactionId: 'tx-2' }], nextToken: null });
    mocks.normalize.mockImplementation(transactions => transactions);
    mocks.importObservations
      .mockResolvedValueOnce({ observed: 1, ignored: 0 })
      .mockResolvedValueOnce({ observed: 1, ignored: 0 });
    mocks.reconcile.mockResolvedValue({ created: 1, ambiguous: 0, ignored: 0 });
    mocks.report.mockResolvedValue(1);
  });

  it('persists every finance page, reconciles, and advances the exact-instance cursor last', async () => {
    await expect(syncAmazonRefundsForChannel({
      businessId: 'business-1', channelInstanceId: 'instance-1', now: new Date('2026-09-16T00:02:00Z'),
    })).resolves.toEqual({ scanned: 2, observed: 2, ignored: 0, created: 1, ambiguous: 0 });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.list.mock.calls[0][1]).toEqual({
      postedAfter: '2026-09-12T00:00:00.000Z', postedBefore: '2026-09-16T00:00:00.000Z', nextToken: null,
    });
    expect(mocks.list.mock.calls[1][1].nextToken).toBe('next-1');
    expect(mocks.setCursor).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', lastPostedAt: '2026-09-16T00:00:00.000Z',
      ambiguousCount: 0,
    });
    expect(mocks.setCursor.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.reconcile.mock.invocationCallOrder[0]);
  });

  it('does not advance the cursor when a finance page fails', async () => {
    mocks.list.mockReset();
    mocks.list.mockRejectedValue(new Error('Amazon finance transactions failed with HTTP 503.'));
    await expect(syncAmazonRefundsForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .rejects.toThrow('HTTP 503');
    expect(mocks.setCursor).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'sync_refunds',
      context: expect.objectContaining({ channelInstanceId: 'instance-1' }),
    }));
  });
});