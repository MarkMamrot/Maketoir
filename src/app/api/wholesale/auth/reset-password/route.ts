import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, execute } from '@/services/MySQLService';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getImsDbName } from '@/lib/db/BusinessRegistry';

/**
 * POST /api/wholesale/auth/reset-password
 * Body: { token, password }
 *
 * Used for both first-time password setup and password reset flows.
 * Validates the token, hashes the new password, and updates ims_contacts.
 */
export async function POST(req: Request) {
  try {
    const body     = await req.json();
    const token    = (body.token    ?? '').trim();
    const password = (body.password ?? '');

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and password are required.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters.' },
        { status: 400 },
      );
    }

    // ── 1. Look up the token in the main DB ───────────────────────────────────
    const rows = await query<{
      id:          number;
      business_id: string;
      contact_id:  number;
      expires_at:  string;
      used_at:     string | null;
    }>(
      `SELECT id, business_id, contact_id, expires_at, used_at
       FROM wholesale_password_reset_tokens
       WHERE token = ?
       LIMIT 1`,
      [token],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 400 });
    }

    const row = rows[0];

    if (row.used_at) {
      return NextResponse.json({ error: 'This link has already been used.' }, { status: 400 });
    }

    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This link has expired. Please request a new one.' },
        { status: 400 },
      );
    }

    // ── 2. Hash and save the new password in the correct IMS schema ──────────
    const hash   = await bcrypt.hash(password, 12);
    const imsDb  = await getImsDbName(row.business_id);
    const pool   = getIMSPool(imsDb);

    await pool.execute(
      `UPDATE ims_contacts SET password_hash = ? WHERE id = ? AND is_active = 1`,
      [hash, row.contact_id],
    );

    // ── 3. Mark token as used ─────────────────────────────────────────────────
    await execute(
      `UPDATE wholesale_password_reset_tokens SET used_at = NOW() WHERE id = ?`,
      [row.id],
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[wholesale/auth/reset-password]', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
