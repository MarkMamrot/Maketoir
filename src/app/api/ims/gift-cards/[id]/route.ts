import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// ── PUT /api/ims/gift-cards/[id] ──────────────────────────────────────────────
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const body = await req.json();
    const { code, initial_balance, balance, status, currency, expires_on, customer_id, order_id, recipient_email, notes, last_used_at } = body;

    await imsExecute(
      `UPDATE gift_cards SET
         code            = ?,
         initial_balance = ?,
         balance         = ?,
         status          = ?,
         currency        = ?,
         expires_on      = ?,
         customer_id     = ?,
         order_id        = ?,
         recipient_email = ?,
         notes           = ?,
         last_used_at    = ?
       WHERE id = ?`,
      [
        String(code ?? '').trim().toUpperCase(),
        initial_balance ?? null,
        Number(balance ?? 0),
        status ?? 'active',
        currency || 'AUD',
        expires_on   || null,
        customer_id  || null,
        order_id     || null,
        recipient_email || null,
        notes           || null,
        last_used_at    || null,
        id,
      ],
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'A gift card with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ── DELETE /api/ims/gift-cards/[id] ──────────────────────────────────────────
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    await imsExecute('DELETE FROM gift_cards WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
