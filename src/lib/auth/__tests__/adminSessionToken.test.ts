import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAdminSession, verifyAdminSession } from '../adminSessionToken';

const NOW_MS = Date.UTC(2026, 7, 16, 10, 0, 0);
const SESSION = {
  userId: 42,
  businessId: 'business-123',
  tier: 'Admin',
  email: 'admin@example.com',
};

describe('adminSessionToken', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a valid session payload', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60 * 60 * 8, nowMs: NOW_MS });

    expect(verifyAdminSession(token, { nowMs: NOW_MS })).toEqual(SESSION);
    expect(JSON.parse(token)).toMatchObject(SESSION);
  });

  it('rejects a session whose payload was modified without resigning', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60 * 60 * 8, nowMs: NOW_MS });
    const tampered = JSON.parse(token);
    tampered.tier = 'SuperAdmin';
    tampered.businessId = 'another-business';

    expect(verifyAdminSession(JSON.stringify(tampered), { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60, nowMs: NOW_MS });

    expect(verifyAdminSession(token, { nowMs: NOW_MS + 60_000 })).toBeNull();
  });

  it('rejects malformed and unsigned legacy cookies', () => {
    expect(verifyAdminSession(JSON.stringify(SESSION), { nowMs: NOW_MS })).toBeNull();
    expect(verifyAdminSession('not-a-session', { nowMs: NOW_MS })).toBeNull();
  });

  it('rejects a token issued too far in the future', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60 * 60, nowMs: NOW_MS + 61_000 });

    expect(verifyAdminSession(token, { nowMs: NOW_MS })).toBeNull();
  });

  it('fails closed when the signing secret is missing or too short', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 60, nowMs: NOW_MS });

    vi.stubEnv('AUTH_SESSION_SECRET', '');
    expect(() => signAdminSession(SESSION, { maxAgeSeconds: 60, nowMs: NOW_MS }))
      .toThrow('AUTH_SESSION_SECRET must be at least 32 bytes.');

    vi.stubEnv('AUTH_SESSION_SECRET', 'short');
    expect(() => verifyAdminSession(token, { nowMs: NOW_MS }))
      .toThrow('AUTH_SESSION_SECRET must be at least 32 bytes.');
  });

  it('rejects invalid session lifetimes', () => {
    expect(() => signAdminSession(SESSION, { maxAgeSeconds: 0, nowMs: NOW_MS }))
      .toThrow('Session maxAgeSeconds must be a positive integer.');
  });
});