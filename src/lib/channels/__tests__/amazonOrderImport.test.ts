import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), changeStatus: vi.fn(), customer: vi.fn(), fallback: vi.fn(),
  fulfil: vi.fn(),
  begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), connectionExecute: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.query,
  imsExecute: mocks.execute,
  getIMSPool: () => ({ getConnection: async () => ({
    beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback,
    release: mocks.release, execute: mocks.connectionExecute,
  }) }),
}));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { changeStatus: mocks.changeStatus } }));
vi.mock('@/lib/ims/orderResolution/customerFulfilment', () => ({ fulfilSalesOrderPartial: mocks.fulfil }));
vi.mock('@/lib/ims/shopifyOrderCustomer', () => ({ getOrCreateOnlineCustomerId: mocks.customer }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ getOrCreateOnlineFallbackVariantId: mocks.fallback }));

import { importAmazonOrder } from '../amazonOrderImport';

const order = {
  AmazonOrderId: '111-2222222-3333333', PurchaseDate: '2026-09-15T01:00:00Z',
  LastUpdateDate: '2026-09-15T01:05:00Z', OrderStatus: 'Unshipped', FulfillmentChannel: 'MFN',
  OrderTotal: { CurrencyCode: 'AUD', Amount: '11.00' }, PaymentMethodDetails: ['Standard'],
};
const items = [{
  ASIN: 'B001', OrderItemId: 'item-1', SellerSKU: 'UNKNOWN', Title: 'Unknown item', QuantityOrdered: 1,
  ItemPrice: { CurrencyCode: 'AUD', Amount: '10.00' }, ItemTax: { CurrencyCode: 'AUD', Amount: '1.00' },
}];

describe('importAmazonOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.changeStatus.mockResolvedValue(undefined);
    mocks.fulfil.mockResolvedValue({ status: 'partially_fulfilled' });
    mocks.customer.mockResolvedValue(9);
    mocks.fallback.mockResolvedValue('fallback-variant');
    mocks.connectionExecute
      .mockResolvedValueOnce([{ insertId: 77 }])
      .mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('updates and confirms an existing draft without inserting another order', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 44, status: 'draft' }]);
    await expect(importAmazonOrder({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7, order, items,
    })).resolves.toEqual({ outcome: 'updated', salesOrderId: 44 });
    expect(mocks.changeStatus).toHaveBeenCalledWith(44, 'confirmed');
    expect(mocks.connectionExecute).not.toHaveBeenCalled();
  });

  it('skips a newly discovered canceled order without creating stock commitments', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(importAmazonOrder({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7,
      order: { ...order, OrderStatus: 'Canceled' }, items,
    })).resolves.toEqual({ outcome: 'skipped', salesOrderId: null });
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it('creates a tax-inclusive paid order and uses the non-stock fallback for an unmapped SKU', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(importAmazonOrder({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7, order, items,
    })).resolves.toEqual({ outcome: 'imported', salesOrderId: 77 });
    expect(mocks.fallback).toHaveBeenCalledWith('business-1');
    expect(mocks.begin).toHaveBeenCalled();
    expect(mocks.commit).toHaveBeenCalled();
    expect(mocks.connectionExecute.mock.calls[0][0]).toContain("'amazon'");
    expect(mocks.connectionExecute.mock.calls[0][1]).toContain('instance-1');
    expect(mocks.connectionExecute.mock.calls[1][1]).toContain('fallback-variant');
    expect(mocks.changeStatus).toHaveBeenCalledWith(77, 'confirmed');
  });

  it('rolls back the draft and lines together when an insert fails', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.connectionExecute
      .mockReset()
      .mockResolvedValueOnce([{ insertId: 77 }])
      .mockRejectedValueOnce(new Error('line insert failed'));
    await expect(importAmazonOrder({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7, order, items,
    })).rejects.toThrow('line insert failed');
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });

  it('applies only the newly observed Amazon shipped quantity', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 44, status: 'partially_fulfilled' }])
      .mockResolvedValueOnce([{ id: 91, external_order_item_id: 'item-1', qty_ordered: 3, qty_fulfilled: 1 }]);
    await importAmazonOrder({
      businessId: 'business-1', channelInstanceId: 'instance-1', locationId: 7,
      order: { ...order, OrderStatus: 'PartiallyShipped', OrderTotal: { CurrencyCode: 'AUD', Amount: '33.00' } },
      items: [{ ...items[0], QuantityOrdered: 3, QuantityShipped: 2,
        ItemPrice: { CurrencyCode: 'AUD', Amount: '30.00' }, ItemTax: { CurrencyCode: 'AUD', Amount: '3.00' } }],
    });
    expect(mocks.fulfil).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', soId: 44, shipmentQuantities: [{ itemId: 91, quantity: 1 }],
      allowIncomingCoveredStockShortfall: true, finalizeWhenComplete: true,
    }));
  });
});