import { beforeEach, describe, expect, it } from 'vitest';
import { signGmailOAuthState, verifyGmailOAuthState } from '../gmailOAuthState';

describe('Gmail OAuth state', () => {
  beforeEach(() => { process.env.OAUTH_STATE_SECRET = 'test-only-secret'; });

  it('round-trips a signed unexpired state', () => {
    const value = signGmailOAuthState({ businessId: 'biz-1', userId: 42, nonce: 'nonce', expiresAt: Date.now() + 1000 });
    expect(verifyGmailOAuthState(value)).toMatchObject({ businessId: 'biz-1', userId: 42, nonce: 'nonce' });
  });

  it('rejects tampering and expiry', () => {
    const value = signGmailOAuthState({ businessId: 'biz-1', userId: 42, nonce: 'nonce', expiresAt: Date.now() - 1 });
    expect(verifyGmailOAuthState(value)).toBeNull();
    expect(verifyGmailOAuthState(`${value}tampered`)).toBeNull();
  });
});