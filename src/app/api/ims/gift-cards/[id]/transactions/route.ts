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
    event_source: string;
    shopify_transaction_id: string | null;
    shopify_processed_at: string | null;
    provider_balance_after: string | null;
    sync_state: string;
    sync_error: string | null;
    actor_name: string | null;
    reference_type: string | null;
    reference_id: string | null;
    notes:         string | null;
    created_at:    string;
  }>(
        `SELECT id, type, amount, balance_after, pos_sale_id,
          event_source, shopify_transaction_id, shopify_processed_at,
          provider_balance_after, sync_state, sync_error, actor_name,
          reference_type, reference_id, notes, created_at
     FROM gift_card_transactions
     WHERE card_id = ?
     ORDER BY created_at ASC`,
    [id],
  );

  return NextResponse.json({ success: true, data: rows });
}
