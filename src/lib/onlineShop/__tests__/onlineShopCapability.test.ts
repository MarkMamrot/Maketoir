import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertNativeShopEnabled: vi.fn() }));

vi.mock('@/lib/ims/businessOperations', () => ({
  assertNativeShopEnabled: mocks.assertNativeShopEnabled,
  isOnlineChannelDisabledError: (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error),
}));

import { nativeShopDisabledResponse } from '../onlineShopCapability';

describe('native shop capability response', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows enabled businesses to continue', async () => {
    mocks.assertNativeShopEnabled.mockResolvedValue(undefined);
    await expect(nativeShopDisabledResponse('business-1')).resolves.toBeNull();
  });

  it('returns the standard disabled response', async () => {
    mocks.assertNativeShopEnabled.mockRejectedValue({
      message: 'Solvantis Online Store is disabled for this business.',
      code: 'native_shop_disabled',
      status: 403,
    });
    const response = await nativeShopDisabledResponse('business-1');
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'native_shop_disabled' });
  });
});