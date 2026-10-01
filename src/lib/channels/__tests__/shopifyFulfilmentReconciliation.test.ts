import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(), orders: vi.fn(), query: vi.fn(), fulfil: vi.fn(),
}));

vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/channels/shopifyOrderFulfilment', () => ({ applyShopifyOrderFulfilment: mocks.fulfil }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    getOrdersUpdatedSince = mocks.orders;
  },
}));

import { reconcileShopifyFulfilmentsForChannel } from '../shopifyFulfilmentReconciliation';

const windowInput = {
  businessId: 'business-1',
  channelInstanceId: 'instance-1',
  windowStart: '2026-09-30T12:00:00.000Z',
  windowEnd: '2026-10-02T00:00:00.000Z',
};

describe('reconcileShopifyFulfilmentsForChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      instance: { settings: { shopify: { orders: { enabled: true, syncFrom: '2026-09-01', locationId: 7 } } } },
      credentials: { shopDomain: 'store.myshopify.com', token: 'secret' },
    });
    mocks.orders.mockResolvedValue([]);
    mocks.fulfil.mockResolvedValue({ outcome: 'fulfilled', salesOrderId: 44 });
  });

  it('repairs only fully fulfilled exact-instance orders inside the fixed window', async () => {
    mocks.orders.mockResolvedValue([
      { id: 1001, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-10-01T01:00:00Z', fulfillment_status: 'fulfilled' },
      { id: 1002, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-10-01T02:00:00Z', fulfillment_status: 'partial' },
      { id: 1003, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-10-02T00:00:01Z', fulfillment_status: 'fulfilled' },
      { id: 1004, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-30T11:59:59Z', fulfillment_status: 'fulfilled' },
      { id: 'invalid', created_at: '2026-09-20T00:00:00Z', updated_at: '2026-10-01T03:00:00Z', fulfillment_status: 'fulfilled' },
    ]);
    mocks.query.mockResolvedValue([{ id: 44, status: 'confirmed' }]);

    const result = await reconcileShopifyFulfilmentsForChannel(windowInput);

    expect(mocks.orders).toHaveBeenCalledWith(windowInput.windowStart);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("sales_channel = 'shopify'"), [
      'business-1', 'instance-1', '1001',
    ]);
    expect(mocks.fulfil).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', topic: 'orders/fulfilled', payload: { id: '1001' },
    });
    expect(result).toMatchObject({
      scanned: 5, providerFulfilled: 1, invalidProviderRows: 1,
      repaired: [{ salesOrderId: 44, shopifyOrderId: '1001' }],
    });
  });

  it('classifies current, missing, and unsupported local orders without mutating them', async () => {
    mocks.orders.mockResolvedValue([
      { id: 1001, created_at: '2026-09-20', updated_at: '2026-10-01T01:00:00Z', fulfillment_status: 'fulfilled' },
      { id: 1002, created_at: '2026-09-20', updated_at: '2026-10-01T02:00:00Z', fulfillment_status: 'fulfilled' },
      { id: 1003, created_at: '2026-09-20', updated_at: '2026-10-01T03:00:00Z', fulfillment_status: 'fulfilled' },
    ]);
    mocks.query
      .mockResolvedValueOnce([{ id: 41, status: 'fulfilled' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 43, status: 'cancelled' }]);

    const result = await reconcileShopifyFulfilmentsForChannel(windowInput);

    expect(result.alreadyCurrent).toBe(1);
    expect(result.missingLocal).toEqual(['1002']);
    expect(result.reviewRequired).toEqual([{ salesOrderId: 43, shopifyOrderId: '1003', status: 'cancelled' }]);
    expect(mocks.fulfil).not.toHaveBeenCalled();
  });

  it('continues after one repair fails and excludes orders before the configured import boundary', async () => {
    mocks.orders.mockResolvedValue([
      { id: 999, created_at: '2026-08-31', updated_at: '2026-10-01T00:00:00Z', fulfillment_status: 'fulfilled' },
      { id: 1001, created_at: '2026-09-20', updated_at: '2026-10-01T01:00:00Z', fulfillment_status: 'fulfilled' },
      { id: 1002, created_at: '2026-09-20', updated_at: '2026-10-01T02:00:00Z', fulfillment_status: 'fulfilled' },
    ]);
    mocks.query
      .mockResolvedValueOnce([{ id: 41, status: 'confirmed' }])
      .mockResolvedValueOnce([{ id: 42, status: 'partially_fulfilled' }]);
    mocks.fulfil
      .mockRejectedValueOnce(new Error('Stock is not covered.'))
      .mockResolvedValueOnce({ outcome: 'fulfilled', salesOrderId: 42 });

    const result = await reconcileShopifyFulfilmentsForChannel(windowInput);

    expect(result.failures).toEqual([{ shopifyOrderId: '1001', salesOrderId: 41, error: 'Stock is not covered.' }]);
    expect(result.repaired).toEqual([{ salesOrderId: 42, shopifyOrderId: '1002' }]);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('does not call Shopify when order synchronization is disabled', async () => {
    mocks.context.mockResolvedValue({
      instance: { settings: { shopify: { orders: { enabled: false } } } },
      credentials: { shopDomain: 'store.myshopify.com', token: 'secret' },
    });

    await expect(reconcileShopifyFulfilmentsForChannel(windowInput)).resolves.toMatchObject({ disabled: true, scanned: 0 });
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});