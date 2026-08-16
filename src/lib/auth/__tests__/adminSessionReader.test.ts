import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieJar } = vi.hoisted(() => ({ cookieJar: {} as Record<string, { value: string }> }));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => cookieJar[name] ?? undefined,
  }),
}));

import { signAdminSession } from '../adminSessionToken';
import { getAdminSession, type AdminSession } from '../../sessionUtils';

const SESSION: AdminSession = {
  name: 'Test Admin',
  company: 'Test Company',
  email: 'admin@example.com',
  businessId: 'business-123',
  role: 'admin',
  tier: 'Admin',
  userId: 42,
};

describe('getAdminSession', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
    delete cookieJar.marketoir_session;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a verified signed admin session', () => {
    cookieJar.marketoir_session = {
      value: signAdminSession(SESSION, { maxAgeSeconds: 600 }),
    };

    expect(getAdminSession()).toEqual(SESSION);
  });

  it('rejects unsigned legacy session JSON', () => {
    cookieJar.marketoir_session = { value: JSON.stringify(SESSION) };

    expect(getAdminSession()).toBeNull();
  });

  it('rejects changes to the visible legacy payload', () => {
    const token = signAdminSession(SESSION, { maxAgeSeconds: 600 });
    const tampered = JSON.parse(token);
    tampered.businessId = 'another-business';
    cookieJar.marketoir_session = { value: JSON.stringify(tampered) };

    expect(getAdminSession()).toBeNull();
  });
});