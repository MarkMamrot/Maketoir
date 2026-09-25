import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), fulfil: vi.fn(), persist: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/ims/orderResolution/customerFulfilment', () => ({
  fulfilSalesOrderPartial: mocks.fulfil,
}));
vi.mock('@/lib/ims/shopifyShipmentPersistence', () => ({
  persistShopifyShipment: mocks.persist,
}));

import { applyShopifyOrderFulfilment } from '@/lib/channels/shopifyOrderFulfilment';

const fulfilment = {
  id: 7001,
  order_id: 1001,
  status: 'success',
  line_items: [{ id: 9001, quantity: 2 }],
};

describe('applyShopifyOrderFulfilment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fulfil.mockResolvedValue({ status: 'fulfilled' });
    mocks.persist.mockResolvedValue(undefined);
  });

  it('fulfils only the order and lines owned by the exact instance', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 44, status: 'confirmed' }])
      .mockResolvedValueOnce([{ id: 55, shopify_line_item_id: '9001', qty_ordered: 2, qty_fulfilled: 0 }]);

    await expect(applyShopifyOrderFulfilment({
      businessId: 'business-1', channelInstanceId: 'instance-2', topic: 'fulfillments/create', payload: fulfilment,
    })).resolves.toEqual({ outcome: 'fulfilled', salesOrderId: 44 });
    expect(mocks.query.mock.calls[0][0]).toContain("sales_channel = 'shopify'");
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.query.mock.calls[1][0]).toContain('external_order_item_id AS shopify_line_item_id');
    expect(mocks.fulfil).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', soId: 44,
      operationKey: 'shopify:instance-2:fulfillments/create:7001',
      shipmentQuantities: [{ itemId: 55, quantity: 2 }],
    }));
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-2', soId: 44,
    }));
  });

  it('does not mutate an order with the same external ID in another instance', async () => {
    mocks.query.mockResolvedValueOnce([]);

    await expect(applyShopifyOrderFulfilment({
      businessId: 'business-1', channelInstanceId: 'instance-3', topic: 'fulfillments/create', payload: fulfilment,
    })).rejects.toThrow('not available for exact-instance fulfilment');
    expect(mocks.fulfil).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('persists a fulfilment update without repeating stock movement', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 44, status: 'partially_fulfilled' }]);

    await expect(applyShopifyOrderFulfilment({
      businessId: 'business-1', channelInstanceId: 'instance-2', topic: 'fulfillments/update', payload: fulfilment,
    })).resolves.toEqual({ outcome: 'shipment_updated', salesOrderId: 44 });
    expect(mocks.fulfil).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('uses outstanding exact order lines for an orders/fulfilled fallback', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 44, status: 'partially_fulfilled' }])
      .mockResolvedValueOnce([
        { id: 55, shopify_line_item_id: '9001', qty_ordered: 3, qty_fulfilled: 1 },
        { id: 56, shopify_line_item_id: '9002', qty_ordered: 1, qty_fulfilled: 1 },
      ]);

    await applyShopifyOrderFulfilment({
      businessId: 'business-1', channelInstanceId: 'instance-2', topic: 'orders/fulfilled',
      payload: { id: 1001 },
    });
    expect(mocks.fulfil).toHaveBeenCalledWith(expect.objectContaining({
      shipmentQuantities: [{ itemId: 55, quantity: 2 }],
    }));
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});