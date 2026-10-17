import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyOrderLease, ShopifyOrderEffectResult } from '../shopifyOrderCoordination';

const mocks = vi.hoisted(() => ({ run: vi.fn(), refund: vi.fn(), fulfil: vi.fn() }));
vi.mock('../shopifyOrderCoordination', () => ({ runShopifyOrderEffect: mocks.run }));
vi.mock('../shopifyOrderRefund', () => ({ applyShopifyOrderRefundInTransaction: mocks.refund }));
vi.mock('../shopifyOrderFulfilment', () => ({ applyShopifyOrderFulfilmentInTransaction: mocks.fulfil }));

import { applyCoordinatedShopifyRefund, applyCoordinatedShopifyFulfilment } from '../shopifyOrderLocalEffects';

const lease: ShopifyOrderLease = {
  businessId: 'alpha', channelInstanceId: 'store', externalOrderId: '123',
  updatedAt: '2026-10-17T01:00:00.000Z', hash: 'a'.repeat(64), token: 'token',
};
const queryConnection: Pick<PoolConnection, 'execute'> = { execute: vi.fn() };
const connection = queryConnection as PoolConnection;

describe('coordinated Shopify local effects', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.run.mockImplementation(async (
      _lease: ShopifyOrderLease, _key: string, callback: (connection: PoolConnection) => Promise<ShopifyOrderEffectResult>,
    ) => ({ duplicate: false, result: await callback(connection) }));
    mocks.refund.mockResolvedValue({ creditNoteId: 81 });
    mocks.fulfil.mockResolvedValue({ salesOrderId: 44 });
  });

  it('uses an exact refund effect key and the coordinator connection', async () => {
    const refund = { id: 7001, order_id: 123 };
    await expect(applyCoordinatedShopifyRefund(lease, refund))
      .resolves.toEqual({ duplicate: false, result: { status: 'applied', referenceId: '81' } });
    expect(mocks.run).toHaveBeenCalledWith(lease, 'refund:7001', expect.any(Function), undefined);
    expect(mocks.refund).toHaveBeenCalledWith(connection, {
      businessId: 'alpha', channelInstanceId: 'store', refund,
    });
  });

  it.each([
    { id: 7001, order_id: 456 }, { id: '../7001', order_id: 123 },
    { id: Number.MAX_SAFE_INTEGER + 1, order_id: 123 }, { id: 0, order_id: 123 },
  ])('rejects mismatched or invalid refund identity before claiming an effect', async refund => {
    await expect(applyCoordinatedShopifyRefund(lease, refund)).rejects.toThrow();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('does not acknowledge a refund without a verified credit note', async () => {
    mocks.refund.mockResolvedValueOnce({ creditNoteId: null });
    await expect(applyCoordinatedShopifyRefund(lease, { id: 7001, order_id: 123 }))
      .rejects.toThrow('no completed credit note');
  });

  it.each([
    ['fulfillments/create', 'fulfilment:7001'],
    ['fulfillments/update', 'shipment:7001'],
    ['orders/fulfilled', 'order_fulfilment'],
  ] as const)('coordinates %s without changing its domain operation identity', async (topic, key) => {
    const payload = topic === 'orders/fulfilled' ? { id: 123 } : { id: 7001, order_id: 123 };
    await expect(applyCoordinatedShopifyFulfilment(lease, { topic, payload }))
      .resolves.toEqual({ duplicate: false, result: { status: 'applied', referenceId: '44' } });
    expect(mocks.run).toHaveBeenCalledWith(lease, key, expect.any(Function), undefined);
    expect(mocks.fulfil).toHaveBeenCalledWith(connection, {
      businessId: 'alpha', channelInstanceId: 'store', topic, payload,
    });
  });

  it('rejects fulfilment of another exact order before opening an effect', async () => {
    await expect(applyCoordinatedShopifyFulfilment(lease, {
      topic: 'fulfillments/create', payload: { id: 7001, order_id: 456 },
    })).rejects.toThrow('claimed order');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('propagates domain failure instead of acknowledging the effect', async () => {
    mocks.fulfil.mockRejectedValueOnce(new Error('Stock conflict'));
    await expect(applyCoordinatedShopifyFulfilment(lease, {
      topic: 'orders/fulfilled', payload: { id: 123 },
    })).rejects.toThrow('Stock conflict');
  });
});
