import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importOrder: vi.fn(), cancel: vi.fn(), fulfil: vi.fn(), refund: vi.fn(),
  update: vi.fn(), loyalty: vi.fn(), giftCards: vi.fn(),
  control: vi.fn(), queue: vi.fn(),
}));
vi.mock('../onlineSyncControl', () => ({ getOnlineSyncControl: mocks.control }));
vi.mock('../shopifyOrderRecovery', () => ({ queueShopifyRecoveryEvent: mocks.queue }));
vi.mock('../shopifyOrderImport', () => ({
  importShopifyOrder: mocks.importOrder, cancelShopifyOrder: mocks.cancel,
}));
vi.mock('../shopifyOrderFulfilment', () => ({ applyShopifyOrderFulfilment: mocks.fulfil }));
vi.mock('../shopifyOrderRefund', () => ({ applyShopifyOrderRefund: mocks.refund }));
vi.mock('../shopifyOrderUpdate', () => ({ updateShopifyOrder: mocks.update }));
vi.mock('../shopifyPaidOrderLoyalty', () => ({ applyShopifyPaidOrderLoyalty: mocks.loyalty }));
vi.mock('@/lib/ims/shopifyGiftCardWebhook', () => ({
  reconcileGiftCardsFromPaidShopifyOrder: mocks.giftCards,
}));

import { processShopifyOrderEvent } from '../shopifyOrderProcessing';

describe('shared Shopify order event processing', () => {
  const owner = { businessId: 'business-1', channelInstanceId: 'instance-2' };
  const input = { ...owner, locationId: 7, topic: 'orders/create', payload: { id: 1001 } };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.control.mockResolvedValue({ mode: 'legacy', paused: false });
    mocks.importOrder.mockResolvedValue({ outcome: 'imported', salesOrderId: 44 });
    mocks.update.mockResolvedValue({ outcome: 'updated', salesOrderId: 44 });
    mocks.cancel.mockResolvedValue({ outcome: 'cancelled', salesOrderId: 44 });
    mocks.fulfil.mockResolvedValue({ outcome: 'fulfilled', salesOrderId: 44 });
    mocks.refund.mockResolvedValue({ outcome: 'refunded', salesOrderId: 44, creditNoteId: 81 });
  });
  it.each(['validation', 'cutover'])('uses one durable full-source path in %s, including while paused', async mode => {
    mocks.control.mockResolvedValue({ mode, paused: true });
    mocks.queue.mockResolvedValue({ eventStatus: 'complete', outcome: 'queued', salesOrderId: null });
    const delivery = { ...input, eventId: 'delivery-1' };
    expect(await processShopifyOrderEvent(delivery)).toEqual({
      eventStatus: 'complete', outcome: 'queued', salesOrderId: null,
    });
    expect(mocks.queue).toHaveBeenCalledWith(delivery);
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.fulfil).not.toHaveBeenCalled();
  });

  it('keeps creation separate from paid-only effects', async () => {
    await expect(processShopifyOrderEvent(input)).resolves.toEqual({
      eventStatus: 'complete', outcome: 'imported', salesOrderId: 44,
    });
    expect(mocks.importOrder).toHaveBeenCalledWith({
      ...owner, locationId: 7, topic: 'orders/create', order: input.payload,
    });
    expect(mocks.loyalty).not.toHaveBeenCalled();
    expect(mocks.giftCards).not.toHaveBeenCalled();
  });

  it('preserves import, loyalty, gift-card ordering for ordinary paid events', async () => {
    await processShopifyOrderEvent({ ...input, topic: 'orders/paid' });
    expect(mocks.loyalty).toHaveBeenCalledWith({ ...owner, order: input.payload });
    expect(mocks.giftCards).toHaveBeenCalledWith('business-1', 'instance-2', input.payload);
    expect(mocks.importOrder.mock.invocationCallOrder[0]).toBeLessThan(mocks.loyalty.mock.invocationCallOrder[0]);
    expect(mocks.loyalty.mock.invocationCallOrder[0]).toBeLessThan(mocks.giftCards.mock.invocationCallOrder[0]);
  });

  it('does not attempt paid effects after import fails', async () => {
    mocks.importOrder.mockRejectedValue(new Error('Import failed'));
    await expect(processShopifyOrderEvent({ ...input, topic: 'orders/paid' })).rejects.toThrow('Import failed');
    expect(mocks.loyalty).not.toHaveBeenCalled();
    expect(mocks.giftCards).not.toHaveBeenCalled();
  });

  it('preserves a skipped import with no local order and does not run paid effects', async () => {
    mocks.importOrder.mockResolvedValue({ outcome: 'skipped', salesOrderId: null });
    await expect(processShopifyOrderEvent({ ...input, topic: 'orders/paid' })).resolves.toEqual({
      eventStatus: 'complete', outcome: 'skipped', salesOrderId: null,
    });
    expect(mocks.loyalty).not.toHaveBeenCalled();
    expect(mocks.giftCards).not.toHaveBeenCalled();
  });

  it('propagates paid effect failures to the delivery owner', async () => {
    mocks.loyalty.mockRejectedValue(new Error('Loyalty failed'));
    await expect(processShopifyOrderEvent({ ...input, topic: 'orders/paid' })).rejects.toThrow('Loyalty failed');
    expect(mocks.giftCards).not.toHaveBeenCalled();
  });

  it.each(['orders/create', 'orders/paid'])('ignores %s without an import location', async topic => {
    await expect(processShopifyOrderEvent({ ...input, locationId: null, topic }))
      .resolves.toEqual({ eventStatus: 'ignored' });
    expect(mocks.importOrder).not.toHaveBeenCalled();
    expect(mocks.loyalty).not.toHaveBeenCalled();
  });

  it('cancels an existing order without requiring an import location', async () => {
    await expect(processShopifyOrderEvent({ ...input, locationId: null, topic: 'orders/cancelled' }))
      .resolves.toEqual({ eventStatus: 'complete', outcome: 'cancelled', salesOrderId: 44 });
    expect(mocks.cancel).toHaveBeenCalledWith({ ...owner, order: input.payload });
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });

  it.each(['fulfillments/create', 'fulfillments/update', 'orders/fulfilled'])(
    'preserves the original fulfilment identity and topic for %s', async topic => {
      await processShopifyOrderEvent({ ...input, topic });
      expect(mocks.fulfil).toHaveBeenCalledWith({ ...owner, topic, payload: input.payload });
      expect(mocks.importOrder).not.toHaveBeenCalled();
    },
  );

  it('preserves the refund result and credit-note identity', async () => {
    await expect(processShopifyOrderEvent({ ...input, topic: 'refunds/create' })).resolves.toEqual({
      eventStatus: 'complete', outcome: 'refunded', salesOrderId: 44, creditNoteId: 81,
    });
    expect(mocks.refund).toHaveBeenCalledWith({ ...owner, refund: input.payload });
  });

  it('does not turn a partially fulfilled update into a full fulfilment', async () => {
    await expect(processShopifyOrderEvent({
      ...input, topic: 'orders/updated', payload: { id: 1001, fulfillment_status: 'partial' },
    })).resolves.toEqual({ eventStatus: 'complete', outcome: 'updated', salesOrderId: 44 });
    expect(mocks.fulfil).not.toHaveBeenCalled();
  });

  it('keeps the full-fulfilment fallback after an order update', async () => {
    const payload = { id: 1001, fulfillment_status: 'fulfilled' };
    await expect(processShopifyOrderEvent({ ...input, topic: 'orders/updated', payload }))
      .resolves.toEqual({ eventStatus: 'complete', outcome: 'fulfilled', salesOrderId: 44 });
    expect(mocks.fulfil).toHaveBeenCalledWith({ ...owner, topic: 'orders/fulfilled', payload });
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.fulfil.mock.invocationCallOrder[0]);
  });

  it('rejects accidental unsupported dispatch instead of importing it as a new order', async () => {
    await expect(processShopifyOrderEvent({ ...input, topic: 'customers/update' }))
      .rejects.toThrow('Unsupported Shopify order-processing topic');
    expect(mocks.importOrder).not.toHaveBeenCalled();
  });
});
