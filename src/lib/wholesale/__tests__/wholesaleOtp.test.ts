import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection, getPool } = vi.hoisted(() => ({
  connection: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    execute: vi.fn(),
    release: vi.fn(),
    rollback: vi.fn(),
  },
  getPool: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ getPool }));

import {
  createWholesaleOtpChallenge,
  hashWholesaleOtpCode,
  verifyWholesaleOtpChallenge,
  wholesaleOtpCodeMatches,
  WHOLESALE_OTP_MAX_ATTEMPTS,
} from '../wholesaleOtp';

const NOW_MS = Date.parse('2026-08-21T05:00:00.000Z');

describe('wholesale OTP challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
    getPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection) });
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it('matches only a six-digit code bound to the challenge token', () => {
    const hash = hashWholesaleOtpCode('challenge-a', '012345');
    expect(wholesaleOtpCodeMatches('challenge-a', '012 345', hash)).toBe(true);
    expect(wholesaleOtpCodeMatches('challenge-b', '012345', hash)).toBe(false);
    expect(wholesaleOtpCodeMatches('challenge-a', '12345', hash)).toBe(false);
  });

  it('invalidates earlier challenges before creating a hashed challenge', async () => {
    const challenge = await createWholesaleOtpChallenge({
      businessId: 'biz-1',
      contactId: 42,
      email: ' Buyer@Example.com ',
      nowMs: NOW_MS,
    });

    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(challenge.challengeToken).not.toContain(challenge.code);
    expect(connection.execute.mock.calls[0][0]).toContain('UPDATE wholesale_otp_challenges');
    expect(connection.execute.mock.calls[1][0]).toContain('INSERT INTO wholesale_otp_challenges');
    const insertValues = connection.execute.mock.calls[1][1];
    expect(insertValues[2]).toBe('buyer@example.com');
    expect(insertValues[3]).not.toBe(challenge.challengeToken);
    expect(insertValues[4]).not.toBe(challenge.code);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('consumes a valid challenge and returns its bound identity', async () => {
    const token = 'challenge-token';
    connection.execute
      .mockResolvedValueOnce([[{
        id: 7,
        business_id: 'biz-1',
        contact_id: 42,
        email: 'buyer@example.com',
        code_hash: hashWholesaleOtpCode(token, '123456'),
        attempt_count: 0,
        expires_at: new Date(NOW_MS + 60_000),
        consumed_at: null,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(verifyWholesaleOtpChallenge({
      challengeToken: token,
      code: '123456',
      businessId: 'biz-1',
      nowMs: NOW_MS,
    })).resolves.toEqual({
      status: 'verified',
      businessId: 'biz-1',
      contactId: 42,
      email: 'buyer@example.com',
    });
    expect(connection.execute.mock.calls[1][0]).toContain('verified_at');
  });

  it('consumes a challenge after the maximum failed attempt', async () => {
    const token = 'challenge-token';
    connection.execute
      .mockResolvedValueOnce([[{
        id: 7,
        business_id: 'biz-1',
        contact_id: 42,
        email: 'buyer@example.com',
        code_hash: hashWholesaleOtpCode(token, '123456'),
        attempt_count: WHOLESALE_OTP_MAX_ATTEMPTS - 1,
        expires_at: new Date(NOW_MS + 60_000),
        consumed_at: null,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(verifyWholesaleOtpChallenge({
      challengeToken: token,
      code: '000000',
      businessId: 'biz-1',
      nowMs: NOW_MS,
    })).resolves.toEqual({ status: 'attempts_exhausted' });
    expect(connection.execute.mock.calls[1][1][0]).toBe(WHOLESALE_OTP_MAX_ATTEMPTS);
  });

  it('marks an expired challenge consumed without checking its code', async () => {
    connection.execute
      .mockResolvedValueOnce([[{
        id: 7,
        business_id: 'biz-1',
        contact_id: 42,
        email: 'buyer@example.com',
        code_hash: '0'.repeat(64),
        attempt_count: 0,
        expires_at: new Date(NOW_MS - 1),
        consumed_at: null,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(verifyWholesaleOtpChallenge({
      challengeToken: 'challenge-token',
      code: '123456',
      businessId: 'biz-1',
      nowMs: NOW_MS,
    })).resolves.toEqual({ status: 'expired' });
  });
});