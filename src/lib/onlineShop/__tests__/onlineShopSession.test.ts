import { afterEach, describe, expect, it, vi } from 'vitest';

import { signOnlineShopSession, verifyOnlineShopSession } from '../onlineShopSession';

afterEach(() => vi.unstubAllEnvs());

describe('online shop session', () => {
  it('round trips a signed tenant customer session', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-native-shop-secret-at-least-32-bytes');
    const token = signOnlineShopSession({ businessId: 'biz-1', contactId: 42, email: 'buyer@example.com', storeSlug: 'demo' }, 1000);
    expect(verifyOnlineShopSession(token, 2000)).toMatchObject({ businessId: 'biz-1', contactId: 42, storeSlug: 'demo' });
  });

  it('rejects tampering and expiry', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-native-shop-secret-at-least-32-bytes');
    const token = signOnlineShopSession({ businessId: 'biz-1', contactId: 42, email: 'buyer@example.com', storeSlug: 'demo' }, 1000);
    expect(verifyOnlineShopSession(`${token}x`, 2000)).toBeNull();
    expect(verifyOnlineShopSession(token, 1000 + 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});