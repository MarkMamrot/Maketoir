import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), getPool: vi.fn(), changeStatus: vi.fn(), fallbackVariant: vi.fn(),
  onlineCustomer: vi.fn(), customerMapping: vi.fn(), connectionExecute: vi.fn(), begin: vi.fn(), commit: vi.fn(),
  rollback: vi.fn(), release: vi.fn(), recomputeBuilds: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.query, imsExecute: mocks.execute, getIMSPool: mocks.getPool,
}));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { changeStatus: mocks.changeStatus } }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ getOrCreateOnlineFallbackVariantId: mocks.fallbackVariant }));
vi.mock('@/lib/ims/shopifyOrderCustomer', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ims/shopifyOrderCustomer')>(),
  getOrCreateOnlineCustomerId: mocks.onlineCustomer,
}));
vi.mock('@/lib/ims/contactChannelMappings', () => ({ getContactChannelMapping: mocks.customerMapping }));
vi.mock('@/lib/ims/builds/buildRequirementService', () => ({
  recomputeBuildRequirementsSafely: mocks.recomputeBuilds,
}));

import { cancelShopifyOrder, importShopifyOrder } from '@/lib/channels/shopifyOrderImport';

const order = {
  id: 1001, name: '#1001', created_at: '2026-09-25T01:00:00Z', currency: 'AUD',
  subtotal_price: '20.00', total_tax: '2.00', total_price: '22.00', total_discounts: '0',
  customer: { id: 7001 }, payment_gateway_names: ['shopify_payments'],
  line_items: [{ id: 9001, variant_id: 8001, quantity: 2, price: '10.00', name: 'Blue Shirt' }],
};

describe('importShopifyOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ getConnection: async () => ({
      execute: mocks.connectionExecute, beginTransaction: mocks.begin, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    }) });
    mocks.onlineCustomer.mockResolvedValue(5);
    mocks.customerMapping.mockResolvedValue({ contactId: 9, mappingStatus: 'linked' });
    mocks.connectionExecute.mockResolvedValueOnce([{ insertId: 44 }]).mockResolvedValue([{ affectedRows: 1 }]);
    mocks.changeStatus.mockResolvedValue(undefined);
    mocks.recomputeBuilds.mockResolvedValue([]);
  });

  it('imports through exact instance mappings and provider-neutral order identity', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ external_variant_id: '8001', variant_id: 'variant-1' }]);

    await expect(importShopifyOrder({ businessId: 'business-1', channelInstanceId: 'instance-2',
      locationId: 7, topic: 'orders/paid', order })).resolves.toEqual({ outcome: 'imported', salesOrderId: 44 });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.query.mock.calls[1][1]).toEqual(['business-1', 'instance-2']);
    expect(mocks.connectionExecute.mock.calls[0][0]).toContain("'shopify'");
    expect(mocks.connectionExecute.mock.calls[0][0]).toContain('channel_instance_id, external_order_id');
    expect(mocks.connectionExecute.mock.calls[0][1]).toEqual(expect.arrayContaining(['business-1', 'instance-2', '1001', 9, 7]));
    expect(mocks.connectionExecute.mock.calls[1][1]).toEqual(expect.arrayContaining(['business-1', 44, '9001', 'variant-1']));
    expect(mocks.changeStatus).toHaveBeenCalledWith(44, 'confirmed');
  });

  it('uses the online customer and non-stock fallback without legacy Shopify identities', async () => {
    mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.customerMapping.mockResolvedValue(null);
    mocks.fallbackVariant.mockResolvedValue('fallback-1');

    await importShopifyOrder({ businessId: 'business-1', channelInstanceId: 'instance-2',
      locationId: 7, topic: 'orders/create', order });
    expect(mocks.fallbackVariant).toHaveBeenCalledWith('business-1');
    expect(mocks.connectionExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([5]));
    expect(mocks.connectionExecute.mock.calls[1][1]).toEqual(expect.arrayContaining(['fallback-1']));
  });

  it('updates only the exact owned order and does not duplicate lines', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 33, status: 'confirmed' }]);
    mocks.execute.mockResolvedValue({ affectedRows: 1 });

    await expect(importShopifyOrder({ businessId: 'business-1', channelInstanceId: 'instance-2',
      locationId: 7, topic: 'orders/paid', order })).resolves.toEqual({ outcome: 'updated', salesOrderId: 33 });
    expect(mocks.execute.mock.calls[0][1].slice(-3)).toEqual([33, 'business-1', 'instance-2']);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });
});

describe('cancelShopifyOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changeStatus.mockResolvedValue(undefined);
    mocks.recomputeBuilds.mockResolvedValue([]);
  });

  it('cancels only the order owned by the exact Shopify instance', async () => {
    mocks.query.mockResolvedValue([{ id: 33, status: 'confirmed' }]);

    await expect(cancelShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', order,
    })).resolves.toEqual({ outcome: 'cancelled', salesOrderId: 33 });
    expect(mocks.query.mock.calls[0][0]).toContain("sales_channel = 'shopify'");
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.changeStatus).toHaveBeenCalledWith(33, 'cancelled');
    expect(mocks.recomputeBuilds).toHaveBeenCalledWith({
      businessId: 'business-1', salesOrderId: 33, sourceChannel: 'shopify',
    });
  });

  it('does not repeat an already applied cancellation', async () => {
    mocks.query.mockResolvedValue([{ id: 33, status: 'cancelled' }]);

    await expect(cancelShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-2', order,
    })).resolves.toEqual({ outcome: 'already_cancelled', salesOrderId: 33 });
    expect(mocks.changeStatus).not.toHaveBeenCalled();
    expect(mocks.recomputeBuilds).not.toHaveBeenCalled();
  });

  it('fails a cancellation when no order is owned by that exact instance', async () => {
    mocks.query.mockResolvedValue([]);

    await expect(cancelShopifyOrder({
      businessId: 'business-1', channelInstanceId: 'instance-3', order,
    })).rejects.toThrow('not available for exact-instance cancellation');
    expect(mocks.changeStatus).not.toHaveBeenCalled();
  });
});