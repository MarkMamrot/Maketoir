import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signAmazonOAuthState, verifyAmazonOAuthState } from '../amazonOAuthState';

describe('Amazon OAuth state', () => {
  beforeEach(() => { process.env.OAUTH_STATE_SECRET = 'amazon-test-state-secret'; });
  afterEach(() => { delete process.env.OAUTH_STATE_SECRET; });

  it('round-trips a bounded business and user authorization', () => {
    const state = { businessId: 'business-1', userId: 7, nonce: 'nonce', displayName: 'Amazon AU', expiresAt: 2_000 };
    expect(verifyAmazonOAuthState(signAmazonOAuthState(state), 1_000)).toEqual(state);
  });

  it('rejects tampered, expired, and overlong state', () => {
    const signed = signAmazonOAuthState({ businessId: 'business-1', userId: 7, nonce: 'nonce', displayName: 'Amazon AU', expiresAt: 2_000 });
    expect(verifyAmazonOAuthState(`${signed}x`, 1_000)).toBeNull();
    expect(verifyAmazonOAuthState(signed, 2_001)).toBeNull();
    expect(verifyAmazonOAuthState(signAmazonOAuthState({ businessId: 'business-1', userId: 7, nonce: 'nonce', displayName: 'x'.repeat(121), expiresAt: 2_000 }), 1_000)).toBeNull();
  });
});
