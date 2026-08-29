import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnectionsGet,
  mockDecrypt,
  mockImsQuery,
  mockShopifyConstructor,
  mockSync,
} = vi.hoisted(() => ({
  mockConnectionsGet: vi.fn(),
  mockDecrypt: vi.fn(),
  mockImsQuery: vi.fn(),
  mockShopifyConstructor: vi.fn(),
  mockSync: vi.fn(),
}));

vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionsGet } }));
vi.mock('@/lib/ims/businessOperations', () => ({
  getOnlineChannelCapabilities: vi.fn().mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: false }),
}));
vi.mock('@/lib/encryption', () => ({ decrypt: mockDecrypt }));
vi.mock('@/lib/ims/shopifyGiftCardSync', () => ({ syncShopifyGiftCardSnapshots: mockSync }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
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
    mockImsQuery.mockResolvedValue([{ value: 'combined' }]);
    mockConnectionsGet.mockResolvedValue({
      shopify_shop_id: 'shop.myshopify.com',
      shopify_access_token: 'encrypted-token',
    });
    mockDecrypt.mockReturnValue('plain-token');
    mockSync.mockResolvedValue({ success: true, synced: 1 });
  });

  it('recognises Shopify gift-card gateway names', () => {
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Shopify Payments', 'gift_card'] })).toBe(true);
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Gift Card'] })).toBe(true);
    expect(hasShopifyGiftCardPayment({ payment_gateway_names: ['Shopify Payments'] })).toBe(false);
  });

  it('does nothing for a paid order without gift-card payment', async () => {
    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', {
      payment_gateway_names: ['Shopify Payments'],
    });

    expect(result).toBeNull();
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('reconciles immediately for a paid gift-card order in Combined mode', async () => {
    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', {
      payment_gateway_names: ['gift_card'],
    });

    expect(result).toMatchObject({ success: true, synced: 1 });
    expect(mockShopifyConstructor).toHaveBeenCalledWith('shop.myshopify.com', 'plain-token');
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith('business-1', expect.anything());
  });

  it('does not reconcile when Shopify gift cards are not in Combined mode', async () => {
    mockImsQuery.mockResolvedValueOnce([{ value: 'solvantis' }]);

    const result = await reconcileGiftCardsFromPaidShopifyOrder('business-1', {
      payment_gateway_names: ['gift_card'],
    });

    expect(result).toBeNull();
    expect(mockConnectionsGet).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});