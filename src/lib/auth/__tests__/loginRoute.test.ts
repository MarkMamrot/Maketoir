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
    mocks.getAuthRateLimit.mockResolvedValue({ locked: false, retryAfterSeconds: 0, failureCount: 0 });
    mocks.findByEmail.mockResolvedValue({ ...USER });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.getMfaTrustCookie.mockReturnValue(null);
    mocks.rotateTrustedBrowser.mockResolvedValue(null);
    mocks.clearAuthRateLimit.mockResolvedValue(undefined);
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

  it('creates enrollment pre-auth without issuing an admin session', async () => {
    const response = await POST(loginRequest({
      email: 'admin@example.com',
      password: 'correct-password',
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
      password: 'correct-password',
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
      password: 'correct-password',
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
    });
    expect(mocks.createPreauthSession).not.toHaveBeenCalled();
    expect(mocks.setAdminSessionCookie).not.toHaveBeenCalled();
  });
});