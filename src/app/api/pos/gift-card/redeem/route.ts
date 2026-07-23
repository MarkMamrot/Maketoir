import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// POST /api/pos/gift-card/redeem — debit a gift card balance
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { code, amount, pos_sale_id } = body;
  if (!code || typeof code !== 'string')
    return NextResponse.json({ error: 'code is required.' }, { status: 400 });
  const debitAmt = Number(amount);
  if (!debitAmt || debitAmt <= 0)
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });

  const rows = await imsQuery(
    'SELECT id, balance, status FROM gift_cards WHERE code = ? LIMIT 1',
    [code.trim()],
  );
  if (!rows.length) return NextResponse.json({ error: 'Gift card not found.' }, { status: 404 });
  const card = rows[0];
  if (card.status !== 'active')
    return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });

  const actualDebit = Math.min(debitAmt, Number(card.balance));
  const newBalance  = Math.max(0, Math.round((Number(card.balance) - actualDebit) * 100) / 100);
  const newStatus   = newBalance <= 0 ? 'redeemed' : 'active';

  await imsExecute(
    `UPDATE gift_cards
     SET balance = ?, status = ?, last_used_at = NOW(),
         order_id = COALESCE(order_id, ?)
     WHERE id = ?`,
    [newBalance, newStatus, pos_sale_id ? String(pos_sale_id) : null, card.id],
  );
  await imsExecute(
    `INSERT INTO gift_card_transactions (card_id, type, amount, balance_after, pos_sale_id)
     VALUES (?, 'redeem', ?, ?, ?)`,
    [card.id, -actualDebit, newBalance, pos_sale_id ?? null],
  );

  return NextResponse.json({ success: true, balance_after: newBalance, status: newStatus });
}
