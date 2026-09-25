import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), processRefund: vi.fn(), reverseRefund: vi.fn(), xero: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { processShopifyRefund: mocks.processRefund },
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: { reverseRefund: mocks.reverseRefund },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({ triggerCNXeroSync: mocks.xero }));

import { applyShopifyOrderRefund } from '@/lib/channels/shopifyOrderRefund';

const refund = {
  id: 7001,
  order_id: 1001,
  transactions: [{ kind: 'refund', status: 'success', amount: '22.00', gateway: 'shopify_payments' }],
  refund_line_items: [{
    line_item_id: 9001,
    quantity: 2,
    subtotal: '20.00',
    total_tax: '2.00',
    restock_type: 'return',
    line_item: { id: 9001, variant_id: 8001, title: 'Blue Shirt', sku: 'BLUE' },
  }],
};

describe('applyShopifyOrderRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processRefund.mockResolvedValue({ processed: true, restocked: 2, creditNoteId: 81 });
    mocks.reverseRefund.mockResolvedValue({ status: 'skipped', reason: 'original_award_not_found' });
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.xero.mockResolvedValue(undefined);
  });

  it('processes a refund through the exact owned order and downstream identities', async () => {
    mocks.query.mockResolvedValue([{ id: 44, payment_gateway: 'shopify_payments' }]);

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2', refund,
    })).resolves.toEqual({ outcome: 'refunded', salesOrderId: 44, creditNoteId: 81 });
    expect(mocks.query.mock.calls[0][0]).toContain("sales_channel = 'shopify'");
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.processRefund).toHaveBeenCalledWith('business-1', expect.objectContaining({
      soId: 44, channelInstanceId: 'instance-2', shopifyRefundId: '7001',
      restockLines: [expect.objectContaining({ externalOrderItemId: '9001' })],
    }));
    expect(mocks.reverseRefund).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyRefundId: '7001',
    }));
    expect(mocks.execute.mock.calls[0][1]).toEqual([44, 'business-1', 'instance-2']);
    expect(mocks.xero).toHaveBeenCalledWith('business-1', 81);
  });

  it('does not select an order with the same external ID in another instance', async () => {
    mocks.query.mockResolvedValue([]);

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-3', refund,
    })).rejects.toThrow('not available for exact-instance refund');
    expect(mocks.processRefund).not.toHaveBeenCalled();
  });

  it('does not repeat loyalty, status, or Xero effects for a duplicate refund', async () => {
    mocks.query.mockResolvedValue([{ id: 44, payment_gateway: null }]);
    mocks.processRefund.mockResolvedValue({ processed: false, restocked: 0, creditNoteId: 81 });

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2', refund,
    })).resolves.toEqual({ outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81 });
    expect(mocks.reverseRefund).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.xero).not.toHaveBeenCalled();
  });
});