import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connection, pool } = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return {
    connection,
    pool: {
      execute: vi.fn(),
      getConnection: vi.fn().mockResolvedValue(connection),
    },
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: () => pool }));
vi.mock('@/lib/encryption', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
}));

import { hashMfaValue, hashRecoveryCode } from '../mfaTokens';
import {
  consumeRecoveryCode,
  createPreauthSession,
  enableTotpWithRecoveryCodes,
  rotateTrustedBrowser,
} from '../mfaRepository';

describe('mfaRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.getConnection.mockResolvedValue(connection);
  });

  it('atomically consumes a recovery code using only its hash', async () => {
    connection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(consumeRecoveryCode(42, 'ABCDE-12345-FEDCB-98765')).resolves.toBe(true);

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('consumed_at = NOW(3)'),
      [42, hashRecoveryCode('ABCDE-12345-FEDCB-98765')],
    );
    expect(JSON.stringify(connection.execute.mock.calls)).not.toContain('ABCDE-12345-FEDCB-98765');
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('stores a pre-auth bearer token only as a hash', async () => {
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await createPreauthSession({
      userId: 42,
      purpose: 'challenge',
      destination: 'ims',
      ttlSeconds: 600,
    });

    const insertCall = connection.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO mfa_preauth_sessions'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(hashMfaValue(result.token));
    expect(insertCall![1]).not.toContain(result.token);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('rotates a trusted-browser token without extending its absolute expiry', async () => {
    const absoluteExpiry = new Date('2026-09-15T10:00:00.000Z');
    connection.execute
      .mockResolvedValueOnce([[{ id: 8, expires_at: absoluteExpiry }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await rotateTrustedBrowser(42, 'old-browser-token');

    expect(result).not.toBeNull();
    expect(result!.token).not.toBe('old-browser-token');
    expect(result!.expiresAt).toEqual(absoluteExpiry);
    expect(connection.execute.mock.calls[0][1]).toEqual([42, hashMfaValue('old-browser-token')]);
    expect(connection.execute.mock.calls[1][1][0]).toBe(hashMfaValue(result!.token));
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('does not enable TOTP when no pending encrypted seed exists', async () => {
    connection.execute
      .mockResolvedValueOnce([[
        {
          id: 9,
          user_id: 42,
          purpose: 'enroll',
          destination: 'ims',
          attempt_count: 0,
          expires_at: new Date('2026-08-16T10:10:00.000Z'),
        },
      ]])
      .mockResolvedValueOnce([[]]);

    await expect(enableTotpWithRecoveryCodes(9, 42, 123, ['ABCDE-12345-FEDCB-98765']))
      .resolves.toBe(false);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});