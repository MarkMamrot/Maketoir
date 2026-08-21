import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query, execute } from '@/services/MySQLService';
import { getIMSPool } from '@/services/IMSMySQLService';
import { getImsDbName } from '@/lib/db/BusinessRegistry';
import { isWholesaleContactEligible, isWholesaleEnabled } from '@/lib/wholesale/wholesaleAccess';

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

    const [accessRows] = await pool.execute(
      `SELECT c.type, c.price_tier, c.is_active,
              (SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'sells_wholesale' LIMIT 1) AS sells_wholesale
         FROM ims_contacts c
        WHERE c.id = ? AND c.business_id = ?
        LIMIT 1`,
      [row.business_id, row.contact_id, row.business_id],
    ) as [Array<{ type: string; price_tier: string; is_active: number; sells_wholesale: string | null }>, any];
    const access = accessRows[0];
    if (!access || !isWholesaleEnabled(access.sells_wholesale) || !isWholesaleContactEligible(access.type, access.price_tier, access.is_active)) {
      return NextResponse.json({ error: 'Wholesale portal is not enabled for this account.', code: 'wholesale_disabled' }, { status: 403 });
    }

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
