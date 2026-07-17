import { NextResponse } from 'next/server';
import { getIMSPool } from '@/services/IMSMySQLService';
import { primeImsDbMap } from '@/lib/db/BusinessRegistry';
import { query } from '@/services/MySQLService';
import { sendPasswordEmail } from '../login/route';

/**
 * POST /api/wholesale/auth/forgot-password
 * Body: { email }
 *
 * Looks up the wholesale contact by email and sends a password reset link.
 * Always returns success to prevent email enumeration.
 */
export async function POST(req: Request) {
  try {
    const body  = await req.json();
    const email = (body.email ?? '').toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // Find the wholesale contact across all IMS schemas (same logic as login)
    await primeImsDbMap();

    const defaultDb = process.env.IMS_MYSQL_DATABASE ?? '';
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

    let foundContact: { id: number; email: string; name: string | null; business_id?: string } | null = null;
    let foundBusinessId = '';

    for (const [imsDb, fallbackBizId] of dbsToSearch) {
      try {
        const pool = getIMSPool(imsDb);
        const [rows] = await pool.execute(
          `SELECT id, email, name, business_id
           FROM ims_contacts
           WHERE LOWER(email) = ? AND price_tier = 'wholesale'
             AND (type = 'customer' OR type = 'both')
             AND is_active = 1
           LIMIT 1`,
          [email],
        ) as [any[], any];

        if (rows.length > 0) {
          foundContact    = rows[0];
          foundBusinessId = (foundContact!.business_id || fallbackBizId) ?? '';
          break;
        }
      } catch { /* schema may not have password_hash column yet */ }
    }

    // Send email only if contact found (but always return success to client)
    if (foundContact) {
      await sendPasswordEmail(foundContact, foundBusinessId, 'reset').catch(err =>
        console.error('[wholesale/forgot-password] email send error:', err),
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[wholesale/auth/forgot-password]', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
