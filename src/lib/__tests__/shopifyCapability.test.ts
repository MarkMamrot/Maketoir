import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertShopifyEnabled: vi.fn() }));

vi.mock('@/lib/ims/businessOperations', () => ({
  assertShopifyEnabled: mocks.assertShopifyEnabled,
  isOnlineChannelDisabledError: (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error),
}));

import { shopifyDisabledResponse } from '../shopifyCapability';

describe('Shopify capability response', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows enabled businesses to continue', async () => {
    mocks.assertShopifyEnabled.mockResolvedValue(undefined);
    await expect(shopifyDisabledResponse('business-1')).resolves.toBeNull();
  });

  it('returns the standard disabled response', async () => {
    mocks.assertShopifyEnabled.mockRejectedValue({
      message: 'Shopify is disabled for this business.',
      code: 'shopify_disabled',
      status: 403,
    });
    const response = await shopifyDisabledResponse('business-1');
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'shopify_disabled' });
  });
});