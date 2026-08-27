import { afterEach, describe, expect, it, vi } from 'vitest';
import { signLoyaltyPortalSession, verifyLoyaltyPortalSession } from '../LoyaltyPortalSession';

afterEach(() => vi.unstubAllEnvs());

describe('loyalty portal session', () => {
  it('round trips a tenant-bound customer session', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-loyalty-portal-secret-at-least-32-bytes');
    const token = signLoyaltyPortalSession({ businessId: 'biz-1', contactId: 42, email: 'a@example.com', portalSlug: 'demo' }, 1000);
    expect(verifyLoyaltyPortalSession(token, 2000)).toMatchObject({ businessId: 'biz-1', contactId: 42, portalSlug: 'demo' });
  });

  it('rejects tampering and expiry', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-loyalty-portal-secret-at-least-32-bytes');
    const token = signLoyaltyPortalSession({ businessId: 'biz-1', contactId: 42, email: 'a@example.com', portalSlug: 'demo' }, 1000);
    expect(verifyLoyaltyPortalSession(`${token}x`, 2000)).toBeNull();
    expect(verifyLoyaltyPortalSession(token, 1000 + 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});