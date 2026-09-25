import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetShopifyOperationContext,
  mockShopifyConstructor,
  mockSync,
} = vi.hoisted(() => ({
  mockGetShopifyOperationContext: vi.fn(),
  mockShopifyConstructor: vi.fn(),
  mockSync: vi.fn(),
}));

vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mockGetShopifyOperationContext }));
vi.mock('@/lib/ims/shopifyGiftCardSync', () => ({ syncShopifyGiftCardSnapshots: mockSync }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    constructor(shop: string, token: string) {
      mockShopifyConstructor(shop, token);
    }
  },
}));

import {
  hasShopifyGiftCardPayment,
  reconcileGiftCardsFromPaidShopifyOrder,
} from '../shopifyGiftCardWebhook';

describe('Shopify paid-order gift-card reconciliation trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShopifyOperationContext.mockResolvedValue({
      instance: { settings: { shopify: { giftCards: { mode: 'combined' } } } },
      credentials: { shopDomain: 'shop.myshopify.com', token: 'plain-token' },
    });
    mockSync.mockResolvedValue({ success: true, synced: 1 });
  });

  it('recognises Shopify gift-card gateway names', () => {
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Shopify Payments', 'gift_card'] })).toBe(true);
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Gift Card'] })).toBe(true);
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Shopify Payments'] })).toBe(false);
  });

  it('does nothing for a paid order without gift-card payment', async () => {
    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', 'shopify-store-1', {
      payment_gateway_names: ['Shopify Payments'],
    });

    expect(result).toBeNull();
    expect(mockGetShopifyOperationContext).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('reconciles immediately for a paid gift-card order in Combined mode', async () => {
    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', 'shopify-store-1', {
      payment_gateway_names: ['gift_card'],
    });

    expect(result).toMatchObject({ success: true, synced: 1 });
    expect(mockShopifyConstructor).toHaveBeenCalledWith('shop.myshopify.com', 'plain-token');
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith('business-1', 'shopify-store-1', expect.anything());
  });

  it('does not reconcile when Shopify gift cards are not in Combined mode', async () => {
    mockGetShopifyOperationContext.mockResolvedValueOnce({
      instance: { settings: { shopify: { giftCards: { mode: 'off' } } } },
      credentials: { shopDomain: 'shop.myshopify.com', token: 'plain-token' },
    });

    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', 'shopify-store-1', {
      payment_gateway_names: ['gift_card'],
    });

    expect(result).toBeNull();
    expect(mockSync).not.toHaveBeenCalled();
  });
});