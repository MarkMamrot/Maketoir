import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  clearAuthRateLimit,
  createAuthRateLimitSubject,
  recordAuthFailure,
} from '../authRateLimit';

const NOW_MS = Date.UTC(2026, 7, 16, 10, 0, 0);

describe('authRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_SESSION_SECRET', 'test-only-session-secret-with-at-least-32-bytes');
    pool.getConnection.mockResolvedValue(connection);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a deterministic pseudonymous subject without exposing its inputs', () => {
    const first = createAuthRateLimitSubject(' Admin@Example.com ', '203.0.113.5');
    const second = createAuthRateLimitSubject('admin@example.com', '203.0.113.5');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('admin@example.com');
    expect(first).not.toContain('203.0.113.5');
  });

  it('inserts the first failure inside a transaction', async () => {
    connection.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(recordAuthFailure({
      action: 'password-login',
      subjectHash: 'a'.repeat(64),
      nowMs: NOW_MS,
    })).resolves.toEqual({ locked: false, retryAfterSeconds: 0, failureCount: 1 });

    expect(connection.execute.mock.calls[1][0]).toContain('INSERT INTO auth_rate_limits');
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('locks on the threshold failure within the active window', async () => {
    connection.execute
      .mockResolvedValueOnce([[
        {
          failure_count: 4,
          window_started_at: new Date(NOW_MS - 60_000),
          locked_until: null,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await recordAuthFailure({
      action: 'mfa-challenge',
      subjectHash: 'b'.repeat(64),
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ locked: true, retryAfterSeconds: 900, failureCount: 5 });
    expect(connection.execute.mock.calls[1][1][2]).toEqual(new Date(NOW_MS + 900_000));
  });

  it('preserves an existing lock without incrementing failures', async () => {
    connection.execute.mockResolvedValueOnce([[
      {
        failure_count: 5,
        window_started_at: new Date(NOW_MS - 60_000),
        locked_until: new Date(NOW_MS + 120_000),
      },
    ]]);

    await expect(recordAuthFailure({
      action: 'mfa-challenge',
      subjectHash: 'c'.repeat(64),
      nowMs: NOW_MS,
    })).resolves.toEqual({ locked: true, retryAfterSeconds: 120, failureCount: 5 });

    expect(connection.execute).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('clears a limiter after successful full authentication', async () => {
    pool.execute.mockResolvedValue([{ affectedRows: 1 }]);

    await clearAuthRateLimit('password-login', 'd'.repeat(64));

    expect(pool.execute).toHaveBeenCalledWith(
      'DELETE FROM auth_rate_limits WHERE action = ? AND subject_hash = ?',
      ['password-login', 'd'.repeat(64)],
    );
  });
});