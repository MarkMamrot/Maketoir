import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/gift-card?code=XXXX — validate a gift card
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code')?.trim();
  if (!code) return NextResponse.json({ error: 'code is required.' }, { status: 400 });

  const rows = await imsQuery(
    'SELECT id, code, balance, status FROM gift_cards WHERE code = ? LIMIT 1',
    [code],
  );
  if (!rows.length) return NextResponse.json({ error: 'Gift card not found.' }, { status: 404 });
  const card = rows[0];
  if (card.status !== 'active')
    return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
  if (Number(card.balance) <= 0)
    return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });

  return NextResponse.json({ id: card.id, code: card.code, balance: Number(card.balance), status: card.status });
}

// POST /api/pos/gift-card — issue a new gift card (Phase 2: sold at POS or issued on return)
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { code, amount, pos_sale_id, recipient_email, notes } = body;
  if (!code || typeof code !== 'string' || !code.trim())
    return NextResponse.json({ error: 'code is required.' }, { status: 400 });
  const amt = Number(amount);
  if (!amt || amt <= 0)
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });

  // Uniqueness check
  const existing = await imsQuery('SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [code.trim()]);
  if (existing.length) return NextResponse.json({ error: 'Gift card code already exists.' }, { status: 409 });

  const result = await imsExecute(
    `INSERT INTO gift_cards (code, initial_balance, balance, status, order_id, recipient_email, notes)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    [code.trim(), amt, amt, pos_sale_id ? String(pos_sale_id) : null, recipient_email ?? null, notes ?? null],
  );
  const cardId = (result as any).insertId;

  // Ledger entry
  await imsExecute(
    `INSERT INTO gift_card_transactions (card_id, type, amount, balance_after, pos_sale_id, notes)
     VALUES (?, 'issue', ?, ?, ?, 'Issued at POS')`,
    [cardId, amt, amt, pos_sale_id ?? null],
  );

  return NextResponse.json({ id: cardId, code: code.trim(), balance: amt }, { status: 201 });
}
