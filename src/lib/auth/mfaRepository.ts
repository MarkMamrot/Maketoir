import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { decrypt, encrypt } from '@/lib/encryption';
import { getPool } from '@/services/MySQLService';
import {
  createOpaqueMfaToken,
  hashMfaValue,
  hashRecoveryCode,
} from '@/lib/auth/mfaTokens';

export type MfaPreauthPurpose = 'enroll' | 'challenge';
export type LoginDestination = 'ims' | 'foresight' | 'pos';

interface TotpStateRow extends RowDataPacket {
  mfa_totp_secret: string | null;
  mfa_enabled: number;
  mfa_last_totp_step: number | null;
}

interface PreauthRow extends RowDataPacket {
  id: number;
  user_id: number;
  purpose: MfaPreauthPurpose;
  destination: LoginDestination;
  attempt_count: number;
  expires_at: Date | string;
}

interface TrustedBrowserRow extends RowDataPacket {
  id: number;
  expires_at: Date | string;
}

export interface MfaTotpState {
  secret: string | null;
  enabled: boolean;
  lastTotpStep: number | null;
}

export interface MfaPreauthSession {
  id: number;
  userId: number;
  purpose: MfaPreauthPurpose;
  destination: LoginDestination;
  attemptCount: number;
  expiresAt: Date;
}

export async function beginTotpEnrollment(userId: number, secret: string): Promise<void> {
  await getPool().execute(
    `UPDATE users
        SET mfa_totp_secret = ?, mfa_enabled = 0, mfa_enabled_at = NULL, mfa_last_totp_step = NULL
      WHERE id = ? AND deleted_at IS NULL`,
    [encrypt(secret), userId],
  );
}

export async function getMfaTotpState(userId: number): Promise<MfaTotpState | null> {
  const [rows] = await getPool().execute<TotpStateRow[]>(
    `SELECT mfa_totp_secret, mfa_enabled, mfa_last_totp_step
       FROM users
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    secret: row.mfa_totp_secret ? decrypt(row.mfa_totp_secret) : null,
    enabled: row.mfa_enabled === 1,
    lastTotpStep: row.mfa_last_totp_step == null ? null : Number(row.mfa_last_totp_step),
  };
}

export async function enableTotpWithRecoveryCodes(
  preauthId: number,
  userId: number,
  acceptedTimeStep: number,
  recoveryCodes: string[],
): Promise<boolean> {
  if (recoveryCodes.length === 0) throw new Error('At least one recovery code is required.');
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [preauthRows] = await connection.execute<PreauthRow[]>(
      `SELECT id, user_id, purpose, destination, attempt_count, expires_at
         FROM mfa_preauth_sessions
        WHERE id = ? AND user_id = ? AND purpose = 'enroll'
          AND consumed_at IS NULL AND expires_at > NOW(3)
        FOR UPDATE`,
      [preauthId, userId],
    );
    if (!preauthRows[0]) {
      await connection.rollback();
      return false;
    }
    const [users] = await connection.execute<TotpStateRow[]>(
      `SELECT mfa_totp_secret, mfa_enabled, mfa_last_totp_step
         FROM users
        WHERE id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!users[0]?.mfa_totp_secret) {
      await connection.rollback();
      return false;
    }

    await connection.execute('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    const placeholders = recoveryCodes.map(() => '(?, ?)').join(', ');
    const values = recoveryCodes.flatMap(code => [userId, hashRecoveryCode(code)]);
    await connection.execute(
      `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ${placeholders}`,
      values,
    );
    await connection.execute(
      `UPDATE users
          SET mfa_enabled = 1, mfa_enabled_at = NOW(3), mfa_last_totp_step = ?
        WHERE id = ?`,
      [acceptedTimeStep, userId],
    );
    await connection.execute(
      'UPDATE mfa_preauth_sessions SET consumed_at = NOW(3) WHERE id = ?',
      [preauthId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function recordAcceptedTotpStep(userId: number, timeStep: number): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE users
        SET mfa_last_totp_step = ?
      WHERE id = ?
        AND mfa_enabled = 1
        AND (mfa_last_totp_step IS NULL OR mfa_last_totp_step < ?)`,
    [timeStep, userId, timeStep],
  );
  return result.affectedRows === 1;
}

export async function replaceRecoveryCodes(userId: number, recoveryCodes: string[]): Promise<void> {
  if (recoveryCodes.length === 0) throw new Error('At least one recovery code is required.');
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    const placeholders = recoveryCodes.map(() => '(?, ?)').join(', ');
    const values = recoveryCodes.flatMap(code => [userId, hashRecoveryCode(code)]);
    await connection.execute(
      `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ${placeholders}`,
      values,
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function consumeRecoveryCode(userId: number, recoveryCode: string): Promise<boolean> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE mfa_recovery_codes
          SET consumed_at = NOW(3)
        WHERE user_id = ? AND code_hash = ? AND consumed_at IS NULL`,
      [userId, hashRecoveryCode(recoveryCode)],
    );
    await connection.commit();
    return result.affectedRows === 1;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createPreauthSession(input: {
  userId: number;
  purpose: MfaPreauthPurpose;
  destination: LoginDestination;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const ttlSeconds = input.ttlSeconds ?? 10 * 60;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 30 * 60) {
    throw new Error('Pre-auth TTL must be between 60 and 1800 seconds.');
  }
  const { token, tokenHash } = createOpaqueMfaToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE mfa_preauth_sessions
          SET consumed_at = COALESCE(consumed_at, NOW(3))
        WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
      [input.userId, input.purpose],
    );
    await connection.execute(
      `INSERT INTO mfa_preauth_sessions
         (user_id, token_hash, purpose, destination, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.userId, tokenHash, input.purpose, input.destination, expiresAt],
    );
    await connection.commit();
    return { token, expiresAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getActivePreauthSession(
  token: string,
  purpose: MfaPreauthPurpose,
): Promise<MfaPreauthSession | null> {
  const [rows] = await getPool().execute<PreauthRow[]>(
    `SELECT id, user_id, purpose, destination, attempt_count, expires_at
       FROM mfa_preauth_sessions
      WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW(3)
      LIMIT 1`,
    [hashMfaValue(token), purpose],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    purpose: row.purpose,
    destination: row.destination,
    attemptCount: Number(row.attempt_count),
    expiresAt: new Date(row.expires_at),
  };
}

export async function recordPreauthFailure(preauthId: number, maxAttempts = 5): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE mfa_preauth_sessions
        SET attempt_count = attempt_count + 1,
            consumed_at = IF(attempt_count + 1 >= ?, NOW(3), consumed_at)
      WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW(3)`,
    [maxAttempts, preauthId],
  );
  return result.affectedRows === 1;
}

export async function consumePreauthSession(preauthId: number): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE mfa_preauth_sessions
        SET consumed_at = NOW(3)
      WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW(3)`,
    [preauthId],
  );
  return result.affectedRows === 1;
}

export async function issueTrustedBrowser(input: {
  userId: number;
  displayLabel: string;
  nowMs?: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const label = input.displayLabel.trim().slice(0, 191) || 'Remembered browser';
  const { token, tokenHash } = createOpaqueMfaToken();
  const issuedAt = new Date(input.nowMs ?? Date.now());
  const expiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  await getPool().execute(
    `INSERT INTO mfa_trusted_browsers
       (user_id, token_hash, display_label, issued_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.userId, tokenHash, label, issuedAt, expiresAt, issuedAt],
  );
  return { token, expiresAt };
}

export async function rotateTrustedBrowser(
  userId: number,
  token: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<TrustedBrowserRow[]>(
      `SELECT id, expires_at
         FROM mfa_trusted_browsers
        WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > NOW(3)
        LIMIT 1
        FOR UPDATE`,
      [userId, hashMfaValue(token)],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return null;
    }
    const rotated = createOpaqueMfaToken();
    await connection.execute(
      'UPDATE mfa_trusted_browsers SET token_hash = ?, last_used_at = NOW(3) WHERE id = ?',
      [rotated.tokenHash, row.id],
    );
    await connection.commit();
    return { token: rotated.token, expiresAt: new Date(row.expires_at) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revokeTrustedBrowser(userId: number, trustedBrowserId: number): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE mfa_trusted_browsers
        SET revoked_at = COALESCE(revoked_at, NOW(3))
      WHERE id = ? AND user_id = ?`,
    [trustedBrowserId, userId],
  );
  return result.affectedRows === 1;
}

export async function revokeAllMfaAccess(userId: number): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE users
          SET mfa_totp_secret = NULL, mfa_enabled = 0, mfa_enabled_at = NULL, mfa_last_totp_step = NULL
        WHERE id = ?`,
      [userId],
    );
    await connection.execute('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
    await connection.execute(
      'UPDATE mfa_preauth_sessions SET consumed_at = COALESCE(consumed_at, NOW(3)) WHERE user_id = ?',
      [userId],
    );
    await connection.execute(
      'UPDATE mfa_trusted_browsers SET revoked_at = COALESCE(revoked_at, NOW(3)) WHERE user_id = ?',
      [userId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}