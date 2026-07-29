import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeMetaAdAccount, signMetaOAuthState, verifyMetaOAuthState } from '../../metaOAuth';

describe('Meta OAuth state', () => {
  beforeEach(() => { process.env.OAUTH_STATE_SECRET = 'test-meta-oauth-secret'; });
  afterEach(() => { delete process.env.OAUTH_STATE_SECRET; });

  it('round-trips a valid tenant-bound state', () => {
    const state = { businessId: 'business-1', userId: 7, nonce: 'nonce', expiresAt: 2_000 };
    expect(verifyMetaOAuthState(signMetaOAuthState(state), 1_000)).toEqual(state);
  });

  it('rejects tampering and expiry', () => {
    const signed = signMetaOAuthState({ businessId: 'business-1', userId: 7, nonce: 'nonce', expiresAt: 2_000 });
    expect(verifyMetaOAuthState(`${signed}x`, 1_000)).toBeNull();
    expect(verifyMetaOAuthState(signed, 2_001)).toBeNull();
  });
});

describe('normalizeMetaAdAccount', () => {
  it('normalizes account identifiers without leaking arbitrary rows', () => {
    expect(normalizeMetaAdAccount({ id: 'act_123', name: 'Retail AU', currency: 'AUD', account_status: 1 })).toEqual({
      id: 'act_123', accountId: '123', name: 'Retail AU', currency: 'AUD', accountStatus: 1,
    });
    expect(normalizeMetaAdAccount({ id: 'not-an-account' })).toBeNull();
  });
});