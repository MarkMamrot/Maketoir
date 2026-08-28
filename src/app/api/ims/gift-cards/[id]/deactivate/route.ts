import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const cardId = Number.parseInt(params.id, 10);
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? '').trim();
  const expectedBalance = Number(body?.expected_balance);
  const idempotencyKey = String(body?.idempotency_key ?? '').trim();
  if (!cardId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'Reason is required.' }, { status: 400 });
  if (!Number.isFinite(expectedBalance)) return NextResponse.json({ error: 'Expected balance is required.' }, { status: 400 });
  if (!idempotencyKey || idempotencyKey.length > 191) return NextResponse.json({ error: 'A valid idempotency key is required.' }, { status: 400 });

  const connection = await getIMSPool().getConnection();
  try {
    const [duplicateRows]: any = await connection.execute(
      'SELECT id, card_id FROM gift_card_transactions WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey],
    );
    if (duplicateRows.length) {
      if (Number(duplicateRows[0].card_id) !== cardId) {
        return NextResponse.json({ error: 'Idempotency key is already used by another gift card.' }, { status: 409 });
      }
      return NextResponse.json({ success: true, duplicate: true, transactionId: duplicateRows[0].id });
    }
    const [rows]: any = await connection.execute(
      'SELECT balance, status, shopify_gc_id FROM gift_cards WHERE id = ? LIMIT 1',
      [cardId],
    );
    const card = rows[0];
    if (!card) return NextResponse.json({ error: 'Gift card not found.' }, { status: 404 });
    if (card.status !== 'active') return NextResponse.json({ error: `Gift card is already ${card.status}.` }, { status: 409 });
    if (Math.abs(Number(card.balance) - expectedBalance) >= 0.005) {
      return NextResponse.json({ error: `Gift card balance changed to ${Number(card.balance).toFixed(2)}. Review and try again.` }, { status: 409 });
    }

    if (card.shopify_gc_id) {
      try {
        const credentials = await getShopifyAdminCredentials(session.businessId);
        if (!credentials) throw new Error('Shopify credentials are not configured.');
        await new ShopifyService(credentials.shopDomain, credentials.token).disableGiftCard(card.shopify_gc_id);
      } catch (error) {
        await reportRuntimeIssue({
          businessId: session.businessId,
          source: 'shopify',
          operation: 'gift_card_deactivate',
          title: 'Gift card could not be deactivated in Shopify',
          error,
          context: { cardId, shopifyGiftCardId: card.shopify_gc_id },
          reference: { type: 'gift_card', id: cardId },
        });
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    await connection.beginTransaction();
    const [insertResult]: any = await connection.execute(
      `INSERT INTO gift_card_transactions
         (card_id, type, amount, balance_after, idempotency_key, event_source, sync_state,
          actor_id, actor_name, reference_type, reference_id, notes)
       VALUES (?, 'deactivate', 0, ?, ?, 'ims', ?, ?, ?, 'gift_card', ?, ?)`,
      [cardId, Number(card.balance), idempotencyKey, card.shopify_gc_id ? 'synced' : 'local_only', session.userId ?? null, session.name ?? session.email ?? null, String(cardId), reason],
    );
    await connection.execute(
      `UPDATE gift_cards
          SET status = 'cancelled', reconciliation_state = ?, reconciliation_reason = NULL,
              shopify_observed_status = ?, last_reconciled_at = NOW()
        WHERE id = ?`,
      [card.shopify_gc_id ? 'matched' : 'local_only', card.shopify_gc_id ? 'cancelled' : null, cardId],
    );
    await connection.commit();
    return NextResponse.json({ success: true, transactionId: Number(insertResult.insertId), status: 'cancelled' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    connection.release();
  }
}