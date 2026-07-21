import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { query, execute } from '@/services/MySQLService';
import { getIMSPool } from '@/services/IMSMySQLService';
import { primeImsDbMap } from '@/lib/db/BusinessRegistry';
import {
  WHOLESALE_SESSION_COOKIE,
  WHOLESALE_SESSION_MAX_AGE,
} from '@/lib/wholesale/wholesaleSession';

/**
 * POST /api/wholesale/auth/login
 * Body: { email, password }
 *
 * • Finds the wholesale contact across all tenant IMS schemas.
 * • If password_hash IS NULL → sends a "set your password" email and returns
 *   { needsPasswordSetup: true } so the UI can show the appropriate message.
 * • Otherwise verifies the bcrypt password and issues a wholesale_session cookie.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email: string = (body.email ?? '').toLowerCase().trim();
    const password: string = body.password ?? '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    // ── 1. Search all IMS schemas for a matching wholesale contact ────────────
    await primeImsDbMap();

    const defaultDb = process.env.IMS_MYSQL_DATABASE ?? '';
    // Map of imsDbName → businessId for all known tenants
    const dbsToSearch = new Map<string, string>();
    if (defaultDb) dbsToSearch.set(defaultDb, '');

    try {
      const bizRows = await query<{ business_id: string; ims_db_name: string | null }>(
        'SELECT business_id, ims_db_name FROM businesses WHERE deleted_at IS NULL',
      );
      for (const b of bizRows) {
        const db = b.ims_db_name || defaultDb;
        if (db) dbsToSearch.set(db, b.business_id);
      }
    } catch { /* businesses table may not exist yet */ }

    let foundContact: {
      id: number; email: string; name: string | null;
      company: string | null; password_hash: string | null;
      business_id: string | null;
    } | null = null;
    let foundBusinessId = '';
    let foundImsDb = '';

    for (const [imsDb, fallbackBizId] of dbsToSearch) {
      try {
        const pool = getIMSPool(imsDb);
        const [rows] = await pool.execute(
          `SELECT id, email, name, company, password_hash, business_id
           FROM ims_contacts
           WHERE LOWER(email) = ? AND price_tier = 'wholesale'
             AND (type = 'b2b_customer' OR type = 'customer' OR type = 'both')
             AND is_active = 1
           LIMIT 1`,
          [email],
        ) as [any[], any];

        if (rows.length > 0) {
          foundContact    = rows[0];
          foundBusinessId = (foundContact!.business_id || fallbackBizId) ?? '';
          foundImsDb      = imsDb;
          break;
        }
      } catch {
        // IMS DB may not have password_hash column yet — run add-wholesale-portal.mjs
      }
    }

    // Generic error message prevents email enumeration
    if (!foundContact) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    // ── 2. No password set → trigger first-time setup email ──────────────────
    if (!foundContact.password_hash) {
      await sendPasswordEmail(
        { id: foundContact.id, email: foundContact.email, name: foundContact.name },
        foundBusinessId,
        'setup',
      );
      return NextResponse.json({ needsPasswordSetup: true });
    }

    // ── 3. Verify password ────────────────────────────────────────────────────
    const valid = await bcrypt.compare(password, foundContact.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    // ── 4. Issue session cookie ───────────────────────────────────────────────
    const sessionData = {
      contactId:  foundContact.id,
      businessId: foundBusinessId,
      imsDb:      foundImsDb,
      email:      foundContact.email,
      name:       foundContact.name   ?? '',
      company:    foundContact.company ?? '',
    };

    cookies().set(WHOLESALE_SESSION_COOKIE, JSON.stringify(sessionData), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   WHOLESALE_SESSION_MAX_AGE,
      path:     '/',
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[wholesale/auth/login]', err);
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}

// ── Shared email helper ───────────────────────────────────────────────────────

export async function sendPasswordEmail(
  contact: { id: number; email: string; name: string | null },
  businessId: string,
  mode: 'setup' | 'reset',
) {
  if (!process.env.RESEND_API_KEY) return;

  // Invalidate any existing unused tokens for this contact
  await execute(
    `UPDATE wholesale_password_reset_tokens
     SET used_at = NOW()
     WHERE business_id = ? AND contact_id = ? AND used_at IS NULL`,
    [businessId, contact.id],
  );

  const token     = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

  await execute(
    `INSERT INTO wholesale_password_reset_tokens
       (business_id, contact_id, email, token, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [businessId, contact.id, contact.email.toLowerCase(), token, expiresAt],
  );

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const actionUrl = `${appUrl}/wholesale/reset-password?token=${token}`;

  const isSetup      = mode === 'setup';
  const subject      = isSetup ? 'Set up your Wholesale Portal password' : 'Reset your Wholesale Portal password';
  const heading      = isSetup ? 'Welcome to the Wholesale Portal' : 'Reset your password';
  const intro        = isSetup
    ? `Hi${contact.name ? ` ${contact.name}` : ''}, your wholesale account is ready. Click below to set your password and gain access.`
    : `Hi${contact.name ? ` ${contact.name}` : ''}, we received a request to reset your wholesale portal password.`;
  const buttonLabel  = isSetup ? 'Set Your Password' : 'Reset Password';

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from:    'Solvantis <onboarding@resend.dev>',
    to:      contact.email.toLowerCase(),
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#1d4ed8;margin:0 0 8px;">${heading}</h2>
        <p style="color:#374151;margin:0 0 24px;">${intro}</p>
        <a href="${actionUrl}"
           style="display:inline-block;padding:12px 28px;background:#1d4ed8;color:#fff;
                  font-weight:700;border-radius:8px;text-decoration:none;">
          ${buttonLabel}
        </a>
        <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">This link expires in 24 hours.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;">Or copy this link:<br>${actionUrl}</p>
      </div>
    `,
  });
}
