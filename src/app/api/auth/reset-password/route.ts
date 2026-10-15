import { NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/services/MySQLService';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { recordAuthEvent } from '@/lib/auth/authActivity';
import { clearAdminSessionCookie, clearMfaTrustCookie } from '@/lib/auth/adminAuthCookies';
import { getPasswordValidation, PasswordPolicyValidationError } from '@/lib/auth/passwordPolicy';

interface ResetTokenRow extends RowDataPacket {
  id: number;
  user_id: number;
  business_id: string | null;
  expires_at: Date | string;
  used_at: Date | string | null;
}

interface PasswordOwnerRow extends RowDataPacket {
  password_hash: string;
  username: string | null;
  email: string;
}

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 */
export async function POST(req: Request) {
  let resetUserId: number | null = null;
  let resetBusinessId: string | null = null;
  try {
    const { token, password } = await req.json();

    if (typeof token !== 'string' || !token || typeof password !== 'string' || !password) {
      return NextResponse.json({ success: false, error: 'Token and password are required.' }, { status: 400 });
    }

    const validation = getPasswordValidation(password);
    if (!validation.isValid) return NextResponse.json({ success: false, error: validation.message }, { status: 400 });

    const hash = await bcrypt.hash(password, 12);
    const tokenHash = createHash('sha256').update(String(token)).digest('hex');
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<ResetTokenRow[]>(
        `SELECT id, user_id, business_id, expires_at, used_at
           FROM password_reset_tokens
          WHERE token IN (?, ?)
          LIMIT 1
          FOR UPDATE`,
        [tokenHash, token],
      );
      const row = rows[0];
      if (!row) {
        await connection.rollback();
        return NextResponse.json({ success: false, error: 'Invalid or expired reset link.' }, { status: 400 });
      }
      if (row.used_at) {
        await connection.rollback();
        return NextResponse.json({ success: false, error: 'This reset link has already been used.' }, { status: 400 });
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await connection.rollback();
        return NextResponse.json({ success: false, error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
      }
      resetUserId = row.user_id;
      resetBusinessId = row.business_id;

      const [owners] = await connection.execute<PasswordOwnerRow[]>(
        'SELECT password_hash, username, email FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [row.user_id],
      );
      const owner = owners[0];
      if (!owner) throw new Error('Password reset user no longer exists.');
      const ownerValidation = getPasswordValidation(password, owner.username ?? owner.email);
      if (!ownerValidation.isValid) throw new PasswordPolicyValidationError(ownerValidation.message);
      const [history] = await connection.execute<Array<RowDataPacket & { password_hash: string }>>(
        'SELECT password_hash FROM user_password_history WHERE user_id = ? ORDER BY id DESC LIMIT 9',
        [row.user_id],
      );
      for (const previous of [owner, ...history]) {
        if (await bcrypt.compare(password, previous.password_hash)) {
          throw new PasswordPolicyValidationError('Choose a password different from your last 10 passwords.');
        }
      }
      await connection.execute('INSERT INTO user_password_history (user_id, password_hash) VALUES (?, ?)', [row.user_id, owner.password_hash]);
      const [userResult] = await connection.execute<ResultSetHeader>(
        `UPDATE users
        SET password_hash = ?, password_changed_at = NOW(3)
          WHERE id = ? AND deleted_at IS NULL`,
        [hash, row.user_id],
      );
      if (userResult.affectedRows !== 1) {
        throw new Error('Password reset user no longer exists.');
      }
      await connection.execute(
        'UPDATE mfa_preauth_sessions SET consumed_at = COALESCE(consumed_at, NOW(3)) WHERE user_id = ?',
        [row.user_id],
      );
      await connection.execute(
        'UPDATE mfa_trusted_browsers SET revoked_at = COALESCE(revoked_at, NOW(3)) WHERE user_id = ?',
        [row.user_id],
      );
      await connection.execute(
        'UPDATE password_reset_tokens SET used_at = NOW(3) WHERE id = ? AND used_at IS NULL',
        [row.id],
      );
      await connection.execute(
        `DELETE FROM user_password_history WHERE user_id = ? AND id NOT IN
          (SELECT id FROM (SELECT id FROM user_password_history WHERE user_id = ? ORDER BY id DESC LIMIT 9) retained)`,
        [row.user_id, row.user_id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    clearAdminSessionCookie();
    clearMfaTrustCookie();
    if (resetUserId != null) {
      await recordAuthEvent({
        userId: resetUserId,
        businessId: resetBusinessId,
        eventType: 'password_reset_completed',
        request: req,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PasswordPolicyValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      source: 'auth.password-reset',
      operation: 'reset_password_and_revoke_mfa',
      severity: 'critical',
      title: 'Password reset failed unexpectedly',
      error,
    });
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
