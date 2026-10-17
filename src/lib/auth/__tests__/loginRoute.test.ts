import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  verifyPassword: vi.fn(),
  clearAdminSessionCookie: vi.fn(),
  clearMfaTrustCookie: vi.fn(),
  getMfaTrustCookie: vi.fn(),
  setAdminSessionCookie: vi.fn(),
  setMfaTrustCookie: vi.fn(),
  createPreauthSession: vi.fn(),
  rotateTrustedBrowser: vi.fn(),
  clearAuthRateLimit: vi.fn(),
  createAuthRateLimitSubject: vi.fn(() => 'subject-hash'),
  getAuthRateLimit: vi.fn(),
  recordAuthFailure: vi.fn(),
  refreshVariantCache: vi.fn(() => Promise.resolve()),
  primeImsDbMap: vi.fn(() => Promise.resolve()),
  reportRuntimeIssue: vi.fn(() => Promise.resolve(null)),
  resolveLoginMembership: vi.fn(),
  recordActiveBusiness: vi.fn(() => Promise.resolve()),
  query: vi.fn(),
  recordAuthEvent: vi.fn(),
}));

vi.mock('@/lib/db/UsersRepository', () => ({
  UsersRepository: {
    findByEmail: mocks.findByEmail,
    verifyPassword: mocks.verifyPassword,
  },
}));
vi.mock('@/lib/auth/adminAuthCookies', () => ({
  clearAdminSessionCookie: mocks.clearAdminSessionCookie,
  clearMfaTrustCookie: mocks.clearMfaTrustCookie,
  getMfaTrustCookie: mocks.getMfaTrustCookie,
  setAdminSessionCookie: mocks.setAdminSessionCookie,
  setMfaTrustCookie: mocks.setMfaTrustCookie,
}));
vi.mock('@/lib/auth/mfaRepository', () => ({
  createPreauthSession: mocks.createPreauthSession,
  rotateTrustedBrowser: mocks.rotateTrustedBrowser,
}));
vi.mock('@/lib/auth/authRateLimit', () => ({
  PLATFORM_AUTH_LOCK_SECONDS: 1800,
  clearAuthRateLimit: mocks.clearAuthRateLimit,
  createAuthRateLimitSubject: mocks.createAuthRateLimitSubject,
  getAuthRateLimit: mocks.getAuthRateLimit,
  recordAuthFailure: mocks.recordAuthFailure,
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: mocks.refreshVariantCache }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ primeImsDbMap: mocks.primeImsDbMap }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/auth/businessMemberships', () => ({
  resolveLoginMembership: mocks.resolveLoginMembership,
  recordActiveBusiness: mocks.recordActiveBusiness,
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/auth/authActivity', () => ({ recordAuthEvent: mocks.recordAuthEvent }));

import { POST } from '@/app/api/auth/login/route';

const USER = {
  id: 42,
  name: 'Admin User',
  company: 'Example Co',
  email: 'admin@example.com',
  business_id: 'business-42',
  role: 'admin',
  tier: 'Admin',
  mfa_enabled: 0,
  password_changed_at: new Date(Date.now() - 2 * 86400000),
};

function loginRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.5, 10.0.0.1',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login MFA gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LIVE_E2E_CONFIRM;
    delete process.env.LIVE_E2E_MFA_BYPASS_EMAIL;
    delete process.env.LIVE_E2E_EXPECTED_BUSINESS_ID;
    mocks.getAuthRateLimit.mockResolvedValue({ locked: false, retryAfterSeconds: 0, failureCount: 0 });
    mocks.findByEmail.mockResolvedValue({ ...USER });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.getMfaTrustCookie.mockReturnValue(null);
    mocks.rotateTrustedBrowser.mockResolvedValue(null);
    mocks.clearAuthRateLimit.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue([]);
    mocks.createPreauthSession.mockResolvedValue({
      token: 'preauth-token',
      expiresAt: new Date('2026-08-16T10:10:00.000Z'),
    });
    mocks.resolveLoginMembership.mockResolvedValue({
      userId: 42,
      businessId: 'business-42',
      businessName: 'Example Co',
      tier: 'Admin',
      isDefault: true,
      lastActiveAt: null,
    });
  });

  it('bypasses MFA only for the explicitly configured paused sandbox on localhost', async () => {
    process.env.LIVE_E2E_CONFIRM = 'MONSTERTHREADS_LIVE_E2E';
    process.env.LIVE_E2E_MFA_BYPASS_EMAIL = 'admin@example.com';
    process.env.LIVE_E2E_EXPECTED_BUSINESS_ID = 'business-42';
    mocks.query.mockResolvedValue([{ is_sandbox: 1, automation_paused: 1 }]);

    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'CompliantPass7!',
      destination: 'ims',
    }));
    const body = await response.json();

    expect(body).toMatchObject({ success: true, nextRoute: '/ims' });
    expect(mocks.setAdminSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.recordActiveBusiness).toHaveBeenCalledWith(42, 'business-42');
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
  });

  it('does not bypass MFA when the configured business is not paused', async () => {
    process.env.LIVE_E2E_CONFIRM = 'MONSTERTHREADS_LIVE_E2E';
    process.env.LIVE_E2E_MFA_BYPASS_EMAIL = 'admin@example.com';
    process.env.LIVE_E2E_EXPECTED_BUSINESS_ID = 'business-42';
    mocks.query.mockResolvedValue([{ is_sandbox: 1, automation_paused: 0 }]);

    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'CompliantPass7!',
      destination: 'ims',
    }));

    expect(await response.json()).toMatchObject({ requiresMfa: true, purpose: 'enroll' });
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });

  it.each([null, new Date(Date.now() - 366 * 86400000)])('allows the configured local paused sandbox test account without password renewal (%s)', async changedAt => {
    process.env.LIVE_E2E_CONFIRM = 'MONSTERTHREADS_LIVE_E2E';
    process.env.LIVE_E2E_MFA_BYPASS_EMAIL = USER.email;
    process.env.LIVE_E2E_EXPECTED_BUSINESS_ID = USER.business_id;
    mocks.query.mockResolvedValue([{ is_sandbox: 1, automation_paused: 1 }]);
    mocks.findByEmail.mockResolvedValue({ ...USER, password_changed_at: changedAt });
    const response = await POST(loginRequest({ email: USER.email, password: 'test-only', destination: 'ims' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, nextRoute: '/ims' });
    expect(mocks.setAdminSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ passwordExpiresAt: undefined }));
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
  });

  it.each(['host', 'email', 'business', 'sandbox', 'paused', 'confirmation'])('still requires renewal when the sandbox exception fails its %s guard', async guard => {
    process.env.LIVE_E2E_CONFIRM = guard === 'confirmation' ? '' : 'MONSTERTHREADS_LIVE_E2E';
    process.env.LIVE_E2E_MFA_BYPASS_EMAIL = guard === 'email' ? 'other@example.com' : USER.email;
    process.env.LIVE_E2E_EXPECTED_BUSINESS_ID = guard === 'business' ? 'other-business' : USER.business_id;
    mocks.query.mockResolvedValue([{ is_sandbox: guard === 'sandbox' ? 0 : 1, automation_paused: guard === 'paused' ? 0 : 1 }]);
    mocks.findByEmail.mockResolvedValue({ ...USER, password_changed_at: null });
    const localRequest = loginRequest({ email: USER.email, password: 'test-only', destination: 'ims' });
    const request = guard === 'host' ? new Request('https://solvantis.com.au/api/auth/login', localRequest) : localRequest;
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'password_renewal_required' });
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });

  it('creates enrollment pre-auth without issuing an admin session', async () => {
    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'CompliantPass7!',
      destination: 'ims',
    }));
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      requiresMfa: true,
      purpose: 'enroll',
      preauthToken: 'preauth-token',
      nextRoute: '/auth/mfa/enroll',
    });
    expect(mocks.createPreauthSession).toHaveBeenCalledWith({
      userId: 42,
      purpose: 'enroll',
      destination: 'ims',
    });
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });

  it('creates challenge pre-auth for an enrolled user without issuing a session', async () => {
    mocks.findByEmail.mockResolvedValue({ ...USER, mfa_enabled: 1 });

    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'CompliantPass7!',
      destination: 'foresight',
    }));
    const body = await response.json();

    expect(body).toMatchObject({ requiresMfa: true, purpose: 'challenge', nextRoute: '/auth/mfa/challenge' });
    expect(mocks.createPreauthSession).toHaveBeenCalledWith({
      userId: 42,
      purpose: 'challenge',
      destination: 'foresight',
    });
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });

  it('issues a session only after rotating a valid trusted-browser token', async () => {
    const expiry = new Date('2026-09-15T10:00:00.000Z');
    mocks.findByEmail.mockResolvedValue({ ...USER, mfa_enabled: 1 });
    mocks.getMfaTrustCookie.mockReturnValue('trusted-token');
    mocks.rotateTrustedBrowser.mockResolvedValue({ token: 'rotated-token', expiresAt: expiry });

    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'CompliantPass7!',
      destination: 'ims',
    }));
    const body = await response.json();

    expect(body).toMatchObject({ success: true, nextRoute: '/ims' });
    expect(mocks.setAdminSessionCookie).toHaveBeenCalledOnce();
    expect(mocks.recordActiveBusiness).toHaveBeenCalledWith(42, 'business-42');
    expect(mocks.setMfaTrustCookie).toHaveBeenCalledWith('rotated-token', expiry);
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
  });

  it('records invalid password attempts without creating pre-auth', async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'wrong-password',
      destination: 'ims',
    }));

    expect(response.status).toBe(401);
    expect(mocks.recordAuthFailure).toHaveBeenCalledWith({
      action: 'password-login',
      subjectHash: 'subject-hash',
      lockSeconds: 1800,
    });
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });

  it.each([null, new Date(Date.now() - 365 * 86400000)])('requires renewal for unknown-age or expired passwords', async changedAt => {
    mocks.findByEmail.mockResolvedValue({ ...USER, password_changed_at: changedAt });
    const response = await POST(loginRequest({ email: USER.email, password: 'CompliantPass7!', destination: 'ims' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'password_renewal_required', nextRoute: '/forgot-password' });
    expect(mocks.clearAdminSessionCookie).toHaveBeenCalled();
    expect(mocks.clearMfaTrustCookie).toHaveBeenCalled();
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('uses the account rather than IP for rate limiting and logs locked attempts', async () => {
    mocks.getAuthRateLimit.mockResolvedValue({ locked: true, retryAfterSeconds: 1800 });
    const response = await POST(loginRequest({ email: USER.email, password: 'CompliantPass7!', destination: 'ims' }));
    expect(mocks.createAuthRateLimitSubject).toHaveBeenCalledWith(USER.email);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1800');
    expect(mocks.findByEmail).not.toHaveBeenCalled();
    expect(mocks.recordAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'login_lockout' }));
  });
});