import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// GET /api/ims/gift-cards/[id]/transactions
// Returns the full balance history for a single gift card.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const rows = await imsQuery<{
    id:            number;
    type:          string;
    amount:        string;
    balance_after: string;
    pos_sale_id:   number | null;
    notes:         string | null;
    created_at:    string;
  }>(
    `SELECT id, type, amount, balance_after, pos_sale_id, notes, created_at
     FROM gift_card_transactions
     WHERE card_id = ?
     ORDER BY created_at ASC`,
    [id],
  );

  return NextResponse.json({ success: true, data: rows });
}
