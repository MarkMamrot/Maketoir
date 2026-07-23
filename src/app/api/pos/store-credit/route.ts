import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

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
  const rows = await imsQuery(
    `SELECT id, first_name, last_name, email, phone, store_credit
     FROM ims_contacts
     WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?
            OR CONCAT(first_name, ' ', last_name) LIKE ?)
       AND deleted_at IS NULL
     ORDER BY CASE WHEN store_credit > 0 THEN 0 ELSE 1 END, last_name, first_name
     LIMIT 10`,
    [like, like, like, like, like],
  );
  return NextResponse.json({
    contacts: rows.map((r: any) => ({
      id:           r.id,
      name:         `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      email:        r.email ?? null,
      phone:        r.phone ?? null,
      store_credit: Number(r.store_credit ?? 0),
    })),
  });
}

// POST /api/pos/store-credit — debit or credit a contact's store credit
// Body: { contact_id, amount, type: 'debit'|'credit', pos_sale_id?, notes? }
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
  if (type !== 'debit' && type !== 'credit')
    return NextResponse.json({ error: 'type must be "debit" or "credit".' }, { status: 400 });

  const rows = await imsQuery(
    'SELECT id, store_credit FROM ims_contacts WHERE id = ? LIMIT 1',
    [contact_id],
  );
  if (!rows.length) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  const contact = rows[0];
  const current = Number(contact.store_credit ?? 0);

  const delta      = type === 'debit' ? -Math.min(amt, current) : amt;
  const newBalance = Math.max(0, Math.round((current + delta) * 100) / 100);

  await imsExecute('UPDATE ims_contacts SET store_credit = ? WHERE id = ?', [newBalance, contact_id]);
  await imsExecute(
    `INSERT INTO store_credit_transactions (contact_id, type, amount, balance_after, pos_sale_id, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contact_id, type === 'debit' ? 'redeem' : 'issue', Math.abs(delta), newBalance, pos_sale_id ?? null, notes ?? null],
  );

  return NextResponse.json({ success: true, balance_after: newBalance });
}
