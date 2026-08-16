import { createHmac } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/services/MySQLService';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_LOCK_SECONDS = 15 * 60;

interface RateLimitRow extends RowDataPacket {
  failure_count: number;
  window_started_at: Date | string;
  locked_until: Date | string | null;
}

export interface AuthRateLimitState {
  locked: boolean;
  retryAfterSeconds: number;
  failureCount: number;
}

export function createAuthRateLimitSubject(...parts: string[]): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AUTH_SESSION_SECRET must be at least 32 bytes.');
  }
  const normalized = parts.map(part => part.trim().toLowerCase()).join('|');
  return createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
}

function stateFromRow(row: RateLimitRow | undefined, nowMs: number): AuthRateLimitState {
  if (!row) return { locked: false, retryAfterSeconds: 0, failureCount: 0 };
  const lockedUntilMs = row.locked_until == null ? 0 : new Date(row.locked_until).getTime();
  return {
    locked: lockedUntilMs > nowMs,
    retryAfterSeconds: lockedUntilMs > nowMs ? Math.ceil((lockedUntilMs - nowMs) / 1000) : 0,
    failureCount: Number(row.failure_count),
  };
}

export async function getAuthRateLimit(
  action: string,
  subjectHash: string,
  nowMs = Date.now(),
): Promise<AuthRateLimitState> {
  const [rows] = await getPool().execute<RateLimitRow[]>(
    `SELECT failure_count, window_started_at, locked_until
       FROM auth_rate_limits
      WHERE action = ? AND subject_hash = ?
      LIMIT 1`,
    [action, subjectHash],
  );
  return stateFromRow(rows[0], nowMs);
}

export async function recordAuthFailure(input: {
  action: string;
  subjectHash: string;
  threshold?: number;
  windowSeconds?: number;
  lockSeconds?: number;
  nowMs?: number;
}): Promise<AuthRateLimitState> {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const windowSeconds = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const lockSeconds = input.lockSeconds ?? DEFAULT_LOCK_SECONDS;
  if (!Number.isSafeInteger(threshold) || threshold < 1) throw new Error('Rate-limit threshold must be positive.');
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new Error('Rate-limit window must be positive.');
  if (!Number.isSafeInteger(lockSeconds) || lockSeconds < 1) throw new Error('Rate-limit lock must be positive.');

  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RateLimitRow[]>(
      `SELECT failure_count, window_started_at, locked_until
         FROM auth_rate_limits
        WHERE action = ? AND subject_hash = ?
        FOR UPDATE`,
      [input.action, input.subjectHash],
    );
    const row = rows[0];
    const existingState = stateFromRow(row, nowMs);
    if (existingState.locked) {
      await connection.commit();
      return existingState;
    }

    const windowExpired = !row || new Date(row.window_started_at).getTime() + windowSeconds * 1000 <= nowMs;
    const failureCount = windowExpired ? 1 : Number(row.failure_count) + 1;
    const windowStartedAt = windowExpired ? now : new Date(row.window_started_at);
    const lockedUntil = failureCount >= threshold
      ? new Date(nowMs + lockSeconds * 1000)
      : null;

    if (!row) {
      await connection.execute(
        `INSERT INTO auth_rate_limits
           (action, subject_hash, failure_count, window_started_at, locked_until)
         VALUES (?, ?, ?, ?, ?)`,
        [input.action, input.subjectHash, failureCount, windowStartedAt, lockedUntil],
      );
    } else {
      await connection.execute(
        `UPDATE auth_rate_limits
            SET failure_count = ?, window_started_at = ?, locked_until = ?
          WHERE action = ? AND subject_hash = ?`,
        [failureCount, windowStartedAt, lockedUntil, input.action, input.subjectHash],
      );
    }
    await connection.commit();
    return {
      locked: lockedUntil !== null,
      retryAfterSeconds: lockedUntil ? lockSeconds : 0,
      failureCount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function clearAuthRateLimit(action: string, subjectHash: string): Promise<void> {
  await getPool().execute(
    'DELETE FROM auth_rate_limits WHERE action = ? AND subject_hash = ?',
    [action, subjectHash],
  );
}