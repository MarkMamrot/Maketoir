import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstance: vi.fn(), setCursor: vi.fn(), access: vi.fn(), listOrders: vi.fn(), listItems: vi.fn(),
  importOrder: vi.fn(), run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  execute: vi.fn(), query: vi.fn(), report: vi.fn(),
}));
vi.mock('../channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, setAmazonOrderSyncCursorForBusiness: mocks.setCursor,
} }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('../amazonSpApi', () => ({ listAmazonFbmOrders: mocks.listOrders, listAmazonOrderItems: mocks.listItems }));
vi.mock('../amazonOrderImport', () => ({ importAmazonOrder: mocks.importOrder }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.execute, imsQuery: mocks.query }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { syncAmazonOrdersForChannel } from '../amazonOrderSync';

const order = {
  AmazonOrderId: '111-2222222-3333333', PurchaseDate: '2026-09-15T00:00:00Z',
  LastUpdateDate: '2026-09-15T00:10:00Z', OrderStatus: 'Unshipped', FulfillmentChannel: 'MFN',
};

describe('syncAmazonOrdersForChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInstance.mockResolvedValue({
      provider: 'amazon', settings: { orderLocationId: 7, ordersLastUpdatedAt: '2026-09-15T00:00:00Z' },
    });
    mocks.access.mockResolvedValue({ accessToken: 'access-token', sellerId: 'A1SELLER99' });
    mocks.listOrders.mockResolvedValue({ orders: [order], nextToken: null });
    mocks.listItems.mockResolvedValue({ items: [{ ASIN: 'B001', OrderItemId: 'item-1', QuantityOrdered: 1 }], nextToken: null });
    mocks.query.mockResolvedValue([{ id: 12, status: 'pending' }]);
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.importOrder.mockResolvedValue({ outcome: 'imported', salesOrderId: 44 });
    mocks.report.mockResolvedValue(1);
  });

  it('imports updated orders inside tenant context and advances a completed cursor', async () => {
    const result = await syncAmazonOrdersForChannel({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      now: new Date('2026-09-15T01:00:00Z'),
    });
    expect(result).toEqual({ scanned: 1, imported: 1, updated: 0, skipped: 0, failed: 0, hasMore: false });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.listOrders.mock.calls[0][1]).toMatchObject({
      lastUpdatedAfter: '2026-09-14T23:55:00.000Z', lastUpdatedBefore: '2026-09-15T00:58:00.000Z',
    });
    expect(mocks.importOrder).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7, order,
    }));
    expect(mocks.setCursor).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', lastUpdatedAt: '2026-09-15T00:58:00.000Z',
    });
  });

  it('records a failed event and does not advance the cursor', async () => {
    mocks.importOrder.mockRejectedValueOnce(new Error('private provider detail'));
    const result = await syncAmazonOrdersForChannel({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      now: new Date('2026-09-15T01:00:00Z'),
    });
    expect(result.failed).toBe(1);
    expect(mocks.setCursor).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(call => String(call[0]).includes("status = 'failed'"))).toBe(true);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'import_order',
      context: { channelInstanceId: 'instance-1', amazonOrderId: order.AmazonOrderId },
    }));
  });

  it('requires a configured per-instance dispatch location', async () => {
    mocks.getInstance.mockResolvedValueOnce({ provider: 'amazon', settings: {} });
    await expect(syncAmazonOrdersForChannel({
      businessId: 'business-1', channelInstanceId: 'instance-1',
    })).rejects.toThrow('Choose a dispatch location');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});