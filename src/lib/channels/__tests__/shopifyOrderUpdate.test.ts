import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), update: vi.fn(), mapping: vi.fn(), fallback: vi.fn(), recompute: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { update: mocks.update } }));
vi.mock('@/lib/ims/contactChannelMappings', () => ({ getContactChannelMapping: mocks.mapping }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ getOrCreateOnlineFallbackVariantId: mocks.fallback }));
vi.mock('@/lib/ims/builds/buildRequirementService', () => ({
  recomputeBuildRequirementsSafely: mocks.recompute,
}));

import { updateShopifyOrder } from '@/lib/channels/shopifyOrderUpdate';

const payload = {
  id: 1001,
  name: '#1001',
  financial_status: 'paid',
  subtotal_price: '20.00',
  total_tax: '2.00',
  total_price: '22.00',
  total_discounts: '0',
  customer: { id: 7001 },
  payment_gateway_names: ['shopify_payments'],
  line_items: [{ id: 9001, variant_id: 8001, quantity: 2, price: '10.00', name: 'Blue Shirt' }],
};

describe('updateShopifyOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.update.mockResolvedValue(undefined);
    mocks.recompute.mockResolvedValue([]);
    mocks.mapping.mockResolvedValue({ contactId: 9, mappingStatus: 'linked' });
  });

  it('updates editable lines through exact mappings and canonical external IDs', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 44, status: 'confirmed' }])
      .mockResolvedValueOnce([{ external_variant_id: '8001', variant_id: 'variant-1' }]);

    await expect(updateShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', order: payload,
    })).resolves.toEqual({ outcome: 'updated', salesOrderId: 44 });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.query.mock.calls[1][1]).toEqual(['business-1', 'instance-2']);
    expect(mocks.update).toHaveBeenCalledWith(44, {}, [expect.objectContaining({
      shopify_line_item_id: '9001', external_order_item_id: '9001', variant_id: 'variant-1',
    })]);
    expect(mocks.execute.mock.calls[0][1].slice(-3)).toEqual([44, 'business-1', 'instance-2']);
    expect(mocks.recompute).toHaveBeenCalledWith({
      businessId: 'business-1', salesOrderId: 44, sourceChannel: 'shopify',
    });
  });

  it('updates metadata but never replaces lines after fulfilment', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 44, status: 'fulfilled' }]);

    await updateShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', order: payload,
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.fallback).not.toHaveBeenCalled();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.recompute).not.toHaveBeenCalled();
  });

  it('does not update an order with the same external ID in another instance', async () => {
    mocks.query.mockResolvedValueOnce([]);

    await expect(updateShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-3', order: payload,
    })).rejects.toThrow('not available for exact-instance update');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});