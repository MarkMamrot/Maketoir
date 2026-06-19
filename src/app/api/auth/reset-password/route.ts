import { NextResponse } from 'next/server';
import { query, execute } from '@/services/MySQLService';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 */
export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ success: false, error: 'Token and password are required.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    const rows = await query<{ id: number; user_id: number; expires_at: string; used_at: string | null }>(
      'SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = ? LIMIT 1',
      [token],
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid or expired reset link.' }, { status: 400 });
    }

    const row = rows[0];

    if (row.used_at) {
      return NextResponse.json({ success: false, error: 'This reset link has already been used.' }, { status: 400 });
    }

    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ success: false, error: 'This reset link has expired. Please request a new one.' }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);

    await execute('UPDATE users SET password_hash = ? WHERE id = ? AND deleted_at IS NULL', [hash, row.user_id]);
    await execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [row.id]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Reset password error:', err);
    return NextResponse.json({ success: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
