import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeGoogleCustomerId,
  normalizeGooglePropertyId,
  signGoogleMarketingOAuthState,
  verifyGoogleMarketingOAuthState,
} from '@/lib/googleMarketingOAuth';

describe('Google marketing OAuth state', () => {
  beforeEach(() => { process.env.OAUTH_STATE_SECRET = 'test-google-marketing-secret'; });
  afterEach(() => { delete process.env.OAUTH_STATE_SECRET; });

  it('round-trips a valid tenant-bound state', () => {
    const state = { businessId: 'business-1', userId: 42, nonce: 'nonce', expiresAt: 2_000 };
    expect(verifyGoogleMarketingOAuthState(signGoogleMarketingOAuthState(state), 1_000)).toEqual(state);
  });

  it('rejects tampered and expired state', () => {
    const signed = signGoogleMarketingOAuthState({ businessId: 'business-1', userId: 42, nonce: 'nonce', expiresAt: 2_000 });
    expect(verifyGoogleMarketingOAuthState(`${signed}x`, 1_000)).toBeNull();
    expect(verifyGoogleMarketingOAuthState(signed, 2_001)).toBeNull();
  });
});

describe('Google marketing identifiers', () => {
  it('normalizes Ads customer IDs', () => {
    expect(normalizeGoogleCustomerId('123-456-7890')).toBe('1234567890');
    expect(normalizeGoogleCustomerId('123')).toBeNull();
  });

  it('normalizes Analytics property IDs', () => {
    expect(normalizeGooglePropertyId('properties/987654')).toBe('987654');
    expect(normalizeGooglePropertyId('property-name')).toBeNull();
  });
});
