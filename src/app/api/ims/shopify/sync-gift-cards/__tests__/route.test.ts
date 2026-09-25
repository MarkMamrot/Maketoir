import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  getShopifyOperationContext: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.getShopifyOperationContext }));
vi.mock('@/lib/ims/shopifyGiftCardSync', () => ({ syncShopifyGiftCardSnapshots: mocks.sync }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {} }));

import { POST } from '../route';

describe('manual Shopify gift-card sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.getShopifyOperationContext.mockResolvedValue({
      instance: { settings: { shopify: { giftCards: { mode: 'combined' } } } },
      credentials: { shopDomain: 'store-two.myshopify.com', token: 'store-two-token' },
    });
    mocks.sync.mockResolvedValue({ success: true, errors: 0, synced: 1 });
  });

  it('requires an explicit Shopify store', async () => {
    const response = await POST(new Request('https://solvantis.com.au/api/ims/shopify/sync-gift-cards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));

    expect(response.status).toBe(400);
    expect(mocks.getShopifyOperationContext).not.toHaveBeenCalled();
  });

  it('syncs only the selected exact Shopify store', async () => {
    const response = await POST(new Request('https://solvantis.com.au/api/ims/shopify/sync-gift-cards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelInstanceId: 'shopify-store-2' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.getShopifyOperationContext).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'shopify-store-2',
    });
    expect(mocks.sync).toHaveBeenCalledWith('business-1', 'shopify-store-2', expect.anything());
  });
});