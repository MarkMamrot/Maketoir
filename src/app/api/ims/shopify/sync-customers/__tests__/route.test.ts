import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  shopifyDisabledResponse: vi.fn(),
  getOperationContext: vi.fn(),
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.shopifyDisabledResponse }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({
  getShopifyOperationContext: mocks.getOperationContext,
  ShopifyOperationContextError: class ShopifyOperationContextError extends Error {},
}));
vi.mock('@/lib/ims/ensureContactShopifyCustomerSchema', () => ({ ensureContactShopifyCustomerSchema: mocks.ensureSchema }));
vi.mock('@/lib/ims/contactChannelMappings', () => ({ getContactChannelMapping: vi.fn(), recordInboundContactChannelMapping: vi.fn() }));
vi.mock('@/lib/ims/shopifyCustomerSync', () => ({ syncRetailCustomerToShopify: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: vi.fn(), imsQuery: vi.fn() }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: vi.fn() }));

import { POST } from '../route';

describe('POST /api/ims/shopify/sync-customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.shopifyDisabledResponse.mockResolvedValue(null);
  });

  it('requires explicit storefront selection before schema or credential work', async () => {
    const response = await POST(new Request('http://localhost/api/ims/shopify/sync-customers', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'pull' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'channelInstanceId is required.' });
    expect(mocks.ensureSchema).not.toHaveBeenCalled();
    expect(mocks.getOperationContext).not.toHaveBeenCalled();
  });
});