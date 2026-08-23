import { describe, expect, it } from 'vitest';
import { createProspectSessionId, getOrCreateProspectSession, isSameOriginRequest, networkFingerprint, PROSPECT_SESSION_COOKIE } from '../session';

describe('prospect sales session', () => {
  it('creates a secure random HttpOnly SameSite=Lax production cookie and restores it', () => {
    const created = getOrCreateProspectSession(null, true);
    expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.cookie).toMatchObject({ name: PROSPECT_SESSION_COOKIE, options: { httpOnly: true, sameSite: 'lax', secure: true } });
    expect(getOrCreateProspectSession(`${PROSPECT_SESSION_COOKIE}=${created.sessionId}`, true)).toEqual({ sessionId: created.sessionId, cookie: null });
    expect(createProspectSessionId()).not.toBe(created.sessionId);
  });

  it('requires the request Origin to match its public origin', () => {
    expect(isSameOriginRequest(new Request('https://solvantis.com.au/api/public/sales-assistant/chat', { headers: { origin: 'https://solvantis.com.au' } }))).toBe(true);
    expect(isSameOriginRequest(new Request('https://solvantis.com.au/api/public/sales-assistant/chat', { headers: { origin: 'https://evil.example' } }))).toBe(false);
    expect(isSameOriginRequest(new Request('https://solvantis.com.au/api/public/sales-assistant/chat'))).toBe(false);
  });

  it('creates a stable HMAC fingerprint without exposing network inputs', () => {
    const request = new Request('https://solvantis.com.au', { headers: { 'x-forwarded-for': '203.0.113.5', 'user-agent': 'Test Browser' } });
    const secret = 'a-secure-test-secret-that-is-longer-than-32-characters';
    const fingerprint = networkFingerprint(request, secret);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).toBe(networkFingerprint(request, secret));
    expect(fingerprint).not.toContain('203.0.113.5');
  });
});
