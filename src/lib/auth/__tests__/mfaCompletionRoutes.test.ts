import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  getActivePreauthSession: vi.fn(),
  getMfaTotpState: vi.fn(),
  recordPreauthFailure: vi.fn(),
  enableTotpWithRecoveryCodes: vi.fn(),
  consumePreauthSession: vi.fn(),
  consumeRecoveryCode: vi.fn(),
  issueTrustedBrowser: vi.fn(),
  recordAcceptedTotpStep: vi.fn(),
  verifyTotpCode: vi.fn(),
  createRecoveryCodes: vi.fn(() => ['AAAAA-BBBBB-CCCCC-DDDDD']),
  clearAuthRateLimit: vi.fn(),
  createAuthRateLimitSubject: vi.fn(() => 'subject-hash'),
  getAuthRateLimit: vi.fn(),
  recordAuthFailure: vi.fn(),
  completeAdminLogin: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/db/UsersRepository', () => ({
  UsersRepository: { findById: mocks.findById },
}));
vi.mock('@/lib/auth/mfaRepository', () => ({
  getActivePreauthSession: mocks.getActivePreauthSession,
  getMfaTotpState: mocks.getMfaTotpState,
  recordPreauthFailure: mocks.recordPreauthFailure,
  enableTotpWithRecoveryCodes: mocks.enableTotpWithRecoveryCodes,
  consumePreauthSession: mocks.consumePreauthSession,
  consumeRecoveryCode: mocks.consumeRecoveryCode,
  issueTrustedBrowser: mocks.issueTrustedBrowser,
  recordAcceptedTotpStep: mocks.recordAcceptedTotpStep,
}));
vi.mock('@/lib/auth/totp', () => ({ verifyTotpCode: mocks.verifyTotpCode }));
vi.mock('@/lib/auth/mfaTokens', () => ({ createRecoveryCodes: mocks.createRecoveryCodes }));
vi.mock('@/lib/auth/authRateLimit', () => ({
  clearAuthRateLimit: mocks.clearAuthRateLimit,
  createAuthRateLimitSubject: mocks.createAuthRateLimitSubject,
  getAuthRateLimit: mocks.getAuthRateLimit,
  recordAuthFailure: mocks.recordAuthFailure,
}));
vi.mock('@/lib/auth/adminLoginCompletion', () => ({
  completeAdminLogin: mocks.completeAdminLogin,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { POST as verifyEnrollment } from '@/app/api/auth/mfa/enroll/verify/route';
import { POST as verifyChallenge } from '@/app/api/auth/mfa/challenge/route';

const USER = {
  id: 42,
  email: 'admin@example.com',
  business_id: 'business-42',
};
const PREAUTH = {
  id: 9,
  userId: 42,
  purpose: 'challenge',
  destination: 'ims',
  attemptCount: 0,
  expiresAt: new Date('2026-08-16T10:10:00.000Z'),
};

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Chrome/140.0' },
    body: JSON.stringify(body),
  });
}

describe('MFA completion routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthRateLimit.mockResolvedValue({ locked: false, retryAfterSeconds: 0, failureCount: 0 });
    mocks.getActivePreauthSession.mockResolvedValue({ ...PREAUTH });
    mocks.findById.mockResolvedValue({ ...USER });
    mocks.completeAdminLogin.mockReturnValue({ nextRoute: '/ims', session: {} });
  });

  it('atomically enables enrollment before issuing the full session', async () => {
    mocks.getActivePreauthSession.mockResolvedValue({ ...PREAUTH, purpose: 'enroll' });
    mocks.getMfaTotpState.mockResolvedValue({ secret: 'TOTPSECRET', enabled: false, lastTotpStep: null });
    mocks.verifyTotpCode.mockResolvedValue({ valid: true, timeStep: 123 });
    mocks.enableTotpWithRecoveryCodes.mockResolvedValue(true);

    const response = await verifyEnrollment(request('/api/auth/mfa/enroll/verify', {
      preauthToken: 'preauth-token',
      code: '123456',
    }));

    expect(response.status).toBe(200);
    expect(mocks.enableTotpWithRecoveryCodes).toHaveBeenCalledWith(
      9,
      42,
      123,
      ['AAAAA-BBBBB-CCCCC-DDDDD'],
    );
    expect(mocks.completeAdminLogin).toHaveBeenCalledWith({
      user: USER,
      destination: 'ims',
    });
  });

  it('rejects an invalid challenge without issuing a full session', async () => {
    mocks.getMfaTotpState.mockResolvedValue({ secret: 'TOTPSECRET', enabled: true, lastTotpStep: 122 });
    mocks.verifyTotpCode.mockResolvedValue({ valid: false, timeStep: null });

    const response = await verifyChallenge(request('/api/auth/mfa/challenge', {
      preauthToken: 'preauth-token',
      code: '000000',
      rememberBrowser: true,
    }));

    expect(response.status).toBe(401);
    expect(mocks.recordPreauthFailure).toHaveBeenCalledWith(9);
    expect(mocks.recordAuthFailure).toHaveBeenCalledOnce();
    expect(mocks.consumePreauthSession).not.toHaveBeenCalled();
    expect(mocks.completeAdminLogin).not.toHaveBeenCalled();
  });

  it('consumes a valid challenge and issues remembered-browser trust', async () => {
    const trustedBrowser = {
      token: 'trusted-token',
      expiresAt: new Date('2026-09-15T10:00:00.000Z'),
    };
    mocks.getMfaTotpState.mockResolvedValue({ secret: 'TOTPSECRET', enabled: true, lastTotpStep: 122 });
    mocks.verifyTotpCode.mockResolvedValue({ valid: true, timeStep: 123 });
    mocks.recordAcceptedTotpStep.mockResolvedValue(true);
    mocks.consumePreauthSession.mockResolvedValue(true);
    mocks.issueTrustedBrowser.mockResolvedValue(trustedBrowser);

    const response = await verifyChallenge(request('/api/auth/mfa/challenge', {
      preauthToken: 'preauth-token',
      code: '123456',
      rememberBrowser: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordAcceptedTotpStep).toHaveBeenCalledWith(42, 123);
    expect(mocks.consumePreauthSession).toHaveBeenCalledWith(9);
    expect(mocks.issueTrustedBrowser).toHaveBeenCalledWith({
      userId: 42,
      displayLabel: 'Google Chrome browser',
    });
    expect(mocks.completeAdminLogin).toHaveBeenCalledWith({
      user: USER,
      destination: 'ims',
      trustedBrowser,
    });
  });
});