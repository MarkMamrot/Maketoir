import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsExecute } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const cardId = Number.parseInt(params.id, 10);
  if (!cardId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  const expectedBalance = Number(body?.expected_balance);
  const reason = String(body?.reason ?? '').trim();
  const idempotencyKey = String(body?.idempotency_key ?? '').trim();
  if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: 'A non-zero adjustment amount is required.' }, { status: 400 });
  if (!Number.isFinite(expectedBalance)) return NextResponse.json({ error: 'Expected balance is required.' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'Reason is required.' }, { status: 400 });
  if (!idempotencyKey || idempotencyKey.length > 191) return NextResponse.json({ error: 'A valid idempotency key is required.' }, { status: 400 });

  const connection = await getIMSPool().getConnection();
  let transactionId = 0;
  let shopifyGiftCardId: string | number | null = null;
  let currency = 'AUD';
  let newBalance = 0;
  try {
    await connection.beginTransaction();
    const [duplicateRows]: any = await connection.execute(
      'SELECT id, balance_after, sync_state FROM gift_card_transactions WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey],
    );
    if (duplicateRows.length) {
      await connection.rollback();
      return NextResponse.json({
        success: true,
        duplicate: true,
        transactionId: duplicateRows[0].id,
        balance: Number(duplicateRows[0].balance_after),
        syncState: duplicateRows[0].sync_state,
      });
    }

    const [cardRows]: any = await connection.execute(
      'SELECT id, balance, currency, status, shopify_gc_id FROM gift_cards WHERE id = ? FOR UPDATE',
      [cardId],
    );
    const card = cardRows[0];
    if (!card) throw new Error('Gift card not found.');
    if (card.status !== 'active') throw new Error(`Gift card is ${card.status}.`);
    const currentBalance = Number(card.balance);
    if (Math.abs(currentBalance - expectedBalance) >= 0.005) throw new Error(`Gift card balance changed to ${currentBalance.toFixed(2)}. Review and try again.`);
    newBalance = Math.round((currentBalance + amount) * 100) / 100;
    if (newBalance < 0) throw new Error('Adjustment cannot reduce the gift card below zero.');
    shopifyGiftCardId = card.shopify_gc_id;
    currency = card.currency || 'AUD';
    const syncState = shopifyGiftCardId ? 'pending' : 'local_only';
    const [insertResult]: any = await connection.execute(
      `INSERT INTO gift_card_transactions
         (card_id, type, amount, balance_after, idempotency_key, event_source, sync_state,
          actor_id, actor_name, reference_type, reference_id, notes)
       VALUES (?, 'adjust', ?, ?, ?, 'ims', ?, ?, ?, 'gift_card', ?, ?)`,
      [cardId, amount, newBalance, idempotencyKey, syncState, session.userId ?? null, session.name ?? session.email ?? null, String(cardId), reason],
    );
    transactionId = Number(insertResult.insertId);
    await connection.execute(
      `UPDATE gift_cards
          SET balance = ?, status = ?, reconciliation_state = ?, reconciliation_reason = ?, last_used_at = NOW()
        WHERE id = ?`,
      [newBalance, newBalance === 0 ? 'redeemed' : 'active', syncState, shopifyGiftCardId ? 'Waiting for Shopify adjustment.' : null, cardId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : message.includes('changed') || message.includes('below zero') || message.includes('is ') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    connection.release();
  }

  if (!shopifyGiftCardId) {
    return NextResponse.json({ success: true, transactionId, balance: newBalance, syncState: 'local_only' });
  }

  try {
    const credentials = await getShopifyAdminCredentials(session.businessId);
    if (!credentials) throw new Error('Shopify credentials are not configured.');
    const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
    const providerNote = `Solvantis transaction ${transactionId}: ${reason}`;
    const result = amount > 0
      ? await shopify.giftCardCredit({ giftCardId: shopifyGiftCardId, amount, currency, note: providerNote })
      : await shopify.giftCardDebit({ giftCardId: shopifyGiftCardId, amount: Math.abs(amount), currency, note: providerNote });
    const balanceMatches = Math.abs(result.balance - newBalance) < 0.005;
    await imsExecute(
      `UPDATE gift_card_transactions
          SET shopify_transaction_id = ?, shopify_processed_at = ?, provider_balance_after = ?,
              sync_state = 'synced', sync_error = NULL
        WHERE id = ?`,
      [result.transactionId, result.processedAt.slice(0, 19).replace('T', ' '), result.balance, transactionId],
    );
    await imsExecute(
      `UPDATE gift_cards
          SET shopify_observed_balance = ?, reconciliation_state = ?, reconciliation_reason = ?, last_reconciled_at = NOW()
        WHERE id = ?`,
      [result.balance, balanceMatches ? 'matched' : 'review_required', balanceMatches ? null : 'Shopify returned a different balance after adjustment.', cardId],
    );
    return NextResponse.json({ success: true, transactionId, balance: newBalance, providerBalance: result.balance, syncState: 'synced' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await imsExecute("UPDATE gift_card_transactions SET sync_state = 'error', sync_error = ? WHERE id = ?", [message.slice(0, 500), transactionId]).catch(() => {});
    await imsExecute("UPDATE gift_cards SET reconciliation_state = 'error', reconciliation_reason = ? WHERE id = ?", [message.slice(0, 500), cardId]).catch(() => {});
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify',
      operation: 'gift_card_adjustment_push',
      title: 'Gift card adjustment is waiting for Shopify',
      error,
      context: { cardId, transactionId, shopifyGiftCardId, amount },
      reference: { type: 'gift_card_transaction', id: transactionId },
    });
    return NextResponse.json({ success: true, transactionId, balance: newBalance, syncState: 'error', warning: 'Saved in Solvantis but not yet applied in Shopify.' }, { status: 202 });
  }
}