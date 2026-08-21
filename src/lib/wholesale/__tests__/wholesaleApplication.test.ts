import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection, getPool } = vi.hoisted(() => ({
  connection: {
    beginTransaction: vi.fn(), commit: vi.fn(), execute: vi.fn(), release: vi.fn(), rollback: vi.fn(),
  },
  getPool: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ getPool }));

import {
  hashWholesaleApplicationToken,
  normalizeWholesaleApplication,
  submitWholesaleApplication,
  verifyWholesaleApplication,
} from '../wholesaleApplication';

const NOW_MS = Date.parse('2026-08-21T06:00:00.000Z');
const application = normalizeWholesaleApplication({
  companyName: ' Example Co ', contactName: ' Alex Buyer ', email: ' Buyer@Example.com ',
  phone: ' 0400 000 000 ', abn: '51 824 753 556', message: ' Please review ', acceptedTerms: true,
});

describe('wholesale applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
    getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('normalizes applicant data and validates consent and ABN', () => {
    expect(application).toEqual({
      companyName: 'Example Co', contactName: 'Alex Buyer', email: 'buyer@example.com',
      phone: '0400 000 000', abn: '51824753556', message: 'Please review', acceptedTerms: true,
    });
    expect(() => normalizeWholesaleApplication({ companyName: 'X', contactName: 'Y', email: 'bad', acceptedTerms: true })).toThrow('valid business email');
    expect(() => normalizeWholesaleApplication({ companyName: 'X', contactName: 'Y', email: 'x@y.com', acceptedTerms: false })).toThrow('accept');
  });

  it('creates a pending application with only a hashed verification token', async () => {
    connection.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 17 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await submitWholesaleApplication({
      businessId: 'biz-1', application, termsVersion: '2026-08-21', privacyVersion: '2026-08-21', nowMs: NOW_MS,
    });
    expect(result.applicationId).toBe(17);
    expect(result.shouldSendVerification).toBe(true);
    expect(connection.execute.mock.calls[1][1]).not.toContain(result.verificationToken);
    expect(connection.execute.mock.calls[1][1]).toContain(hashWholesaleApplicationToken(result.verificationToken));
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('does not reopen an application already awaiting review', async () => {
    connection.execute.mockResolvedValueOnce([[{
      id: 17, business_id: 'biz-1', status: 'pending_review', verification_token_hash: null, verification_expires_at: null,
    }]]);
    const result = await submitWholesaleApplication({
      businessId: 'biz-1', application, termsVersion: 'v1', privacyVersion: 'v1', nowMs: NOW_MS,
    });
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(result.shouldSendVerification).toBe(false);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('atomically moves a valid token to pending review', async () => {
    const token = 'verification-token';
    connection.execute
      .mockResolvedValueOnce([[{
        id: 17, business_id: 'biz-1', status: 'pending_email',
        verification_token_hash: hashWholesaleApplicationToken(token),
        verification_expires_at: new Date(NOW_MS + 60_000),
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(verifyWholesaleApplication({ businessId: 'biz-1', token, nowMs: NOW_MS })).resolves.toBe('verified');
    expect(connection.execute.mock.calls[1][0]).toContain("status = 'pending_review'");
    expect(connection.execute.mock.calls[2][0]).toContain("'email_verified'");
  });

  it('does not verify an expired token', async () => {
    const token = 'verification-token';
    connection.execute.mockResolvedValueOnce([[{
      id: 17, business_id: 'biz-1', status: 'pending_email',
      verification_token_hash: hashWholesaleApplicationToken(token),
      verification_expires_at: new Date(NOW_MS - 1),
    }]]);
    await expect(verifyWholesaleApplication({ businessId: 'biz-1', token, nowMs: NOW_MS })).resolves.toBe('expired');
    expect(connection.execute).toHaveBeenCalledOnce();
  });
});