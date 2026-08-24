import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, getIMSPool } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { syncStoreCreditRedemptionReclass } from '@/services/XeroSyncService';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/store-credit?q=name_or_phone — search contacts, prioritise those with store credit
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const like = `%${q}%`;
  const phoneDigits = q.replace(/\D/g, '');
  const normalizedPhoneLike = phoneDigits.length >= 2 ? `%${phoneDigits}%` : '__no_phone_match__';
  const rows = await imsQuery(
    `SELECT id, name, first_name, last_name, email, phone, store_credit
     FROM ims_contacts
     WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?
            OR REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
            OR name LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ?)
       AND type = 'retail_customer'
       AND is_active = 1
       AND deleted_at IS NULL
     ORDER BY CASE WHEN store_credit > 0 THEN 0 ELSE 1 END, last_name, first_name
     LIMIT 10`,
    [like, like, like, like, normalizedPhoneLike, like, like],
  );
  return NextResponse.json({
    contacts: rows.map((r: any) => ({
      id:           r.id,
      name:         String(r.name ?? '').trim() || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      email:        r.email ?? null,
      phone:        r.phone ?? null,
      store_credit: Number(r.store_credit ?? 0),
    })),
  });
}

// POST /api/pos/store-credit — redeem existing credit. Issues are owned by completed credit notes.
// Body: { contact_id, amount, type: 'debit', pos_sale_id?, notes? }
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { contact_id, amount, type, pos_sale_id, notes } = body;
  if (!contact_id) return NextResponse.json({ error: 'contact_id is required.' }, { status: 400 });
  const amt = Number(amount);
  if (!amt || amt <= 0) return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
  if (type !== 'debit') {
    return NextResponse.json(
      { error: 'Store credit can only be issued by completing a customer credit note.' },
      { status: 400 },
    );
  }

  const businessId = String(session.businessId ?? '');
  const pool = getIMSPool();
  const conn = await pool.getConnection();
  let newBalance = 0;
  let txId = 0;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id, type, store_credit
         FROM ims_contacts
        WHERE id = ? AND business_id = ? AND is_active = 1
        FOR UPDATE`,
      [contact_id, businessId],
    );
    const contact = (rows as { id: number; type: string; store_credit: number }[])[0];
    if (!contact || !['retail_customer', 'b2b_customer', 'both'].includes(contact.type)) {
      await conn.rollback();
      return NextResponse.json({ error: 'Active customer contact not found.' }, { status: 404 });
    }

    const current = Number(contact.store_credit ?? 0);
    if (amt > current) {
      await conn.rollback();
      return NextResponse.json({ error: 'Insufficient store credit.' }, { status: 400 });
    }
    newBalance = Math.round((current - amt) * 100) / 100;
    await conn.execute(
      `UPDATE ims_contacts SET store_credit = ? WHERE id = ? AND business_id = ?`,
      [newBalance, contact_id, businessId],
    );
    const [txResult] = await conn.execute(
      `INSERT INTO store_credit_transactions (contact_id, type, amount, balance_after, pos_sale_id, notes)
       VALUES (?, 'redeem', ?, ?, ?, ?)`,
      [contact_id, amt, newBalance, pos_sale_id ?? null, notes ?? null],
    );
    txId = Number((txResult as any).insertId ?? 0);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  let xeroSynced: boolean | null = null;
  let xeroWarning: string | null = null;
  if (session?.businessId && amt > 0) {
    try {
      const dedupeKey = txId > 0
        ? `store credit redeem tx ${txId}`
        : `store credit redeem contact ${contact_id}|${amt.toFixed(2)}|${pos_sale_id ?? 'na'}`;
      const payload = {
        businessId: session.businessId,
        amount: amt,
        date: new Date().toISOString().slice(0, 10),
        channel: 'pos' as const,
        locationId: session.location_id ?? undefined,
        dedupeKey,
        referenceId: txId > 0 ? txId : undefined,
      };
      const xeroId = await syncStoreCreditRedemptionReclass(payload);
      xeroSynced = !!xeroId;
    } catch (e: any) {
      xeroWarning = e?.message ?? 'Store credit redemption synced locally but failed to post reclass to Xero';
    }
  }

  return NextResponse.json({ success: true, balance_after: newBalance, xero_synced: xeroSynced, xero_warning: xeroWarning });
}
