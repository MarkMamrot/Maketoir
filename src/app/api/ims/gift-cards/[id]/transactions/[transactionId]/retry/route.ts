import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService, type ShopifyGiftCardTransaction } from '@/services/ShopifyService';

interface RetryTransactionRow {
  id: number;
  card_id: number;
  type: string;
  amount: string | number;
  event_source: string;
  sync_state: string;
  pos_sale_id: number | null;
  notes: string | null;
  shopify_gc_id: string | number | null;
  currency: string | null;
  card_balance: string | number;
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string; transactionId: string } },
) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  const cardId = Number.parseInt(params.id, 10);
  const transactionId = Number.parseInt(params.transactionId, 10);
  if (!cardId || !transactionId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const rows = await imsQuery<RetryTransactionRow>(
    `SELECT transaction_row.id, transaction_row.card_id, transaction_row.type, transaction_row.amount,
            transaction_row.event_source, transaction_row.sync_state, transaction_row.pos_sale_id,
            transaction_row.notes, card.shopify_gc_id, card.currency, card.balance AS card_balance
       FROM gift_card_transactions transaction_row
       JOIN gift_cards card ON card.id = transaction_row.card_id
      WHERE transaction_row.id = ? AND transaction_row.card_id = ? LIMIT 1`,
    [transactionId, cardId],
  );
  const transaction = rows[0];
  if (!transaction) return NextResponse.json({ error: 'Gift card transaction not found.' }, { status: 404 });
  if (transaction.sync_state === 'synced') {
    return NextResponse.json({ success: true, duplicate: true, syncState: 'synced' });
  }
  if (transaction.sync_state !== 'error') {
    return NextResponse.json({ error: `Transaction is ${transaction.sync_state}, not retryable.` }, { status: 409 });
  }
  if (!transaction.shopify_gc_id || !['adjust', 'redeem'].includes(transaction.type)) {
    return NextResponse.json({ error: 'This transaction cannot be retried in Shopify.' }, { status: 409 });
  }

  const claim = await imsExecute(
    "UPDATE gift_card_transactions SET sync_state = 'retrying', sync_error = NULL WHERE id = ? AND sync_state = 'error'",
    [transactionId],
  );
  if (Number((claim as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
    return NextResponse.json({ error: 'Transaction is already being retried.' }, { status: 409 });
  }

  const amount = Number(transaction.amount);
  const providerNote = transaction.event_source === 'pos' && transaction.pos_sale_id
    ? `Solvantis POS sale ${transaction.pos_sale_id}`
    : `Solvantis transaction ${transactionId}: ${transaction.notes ?? 'Gift card adjustment'}`;

  try {
    const provider = await ConnectionsRepository.get(session.businessId);
    if (!provider?.shopify_shop_id || !provider.shopify_access_token) throw new Error('Shopify credentials are not configured.');
    let token = provider.shopify_access_token;
    try { token = decrypt(token); } catch { /* unencrypted legacy token */ }
    const shopify = new ShopifyService(provider.shopify_shop_id, token);
    const history = await shopify.getGiftCardTransactions(transaction.shopify_gc_id);
    const existingProviderTransaction = findProviderTransaction(history.transactions, providerNote, amount);
    const result = existingProviderTransaction
      ? {
          transactionId: existingProviderTransaction.transaction.id,
          processedAt: existingProviderTransaction.transaction.processedAt,
          balance: existingProviderTransaction.balanceAfter,
        }
      : amount > 0
        ? await shopify.giftCardCredit({
            giftCardId: transaction.shopify_gc_id,
            amount,
            currency: transaction.currency ?? 'AUD',
            note: providerNote,
          })
        : await shopify.giftCardDebit({
            giftCardId: transaction.shopify_gc_id,
            amount: Math.abs(amount),
            currency: transaction.currency ?? 'AUD',
            note: providerNote,
          });
    const currentProviderBalance = existingProviderTransaction ? history.balance : result.balance;
    const balanceMatches = Math.abs(Number(transaction.card_balance) - currentProviderBalance) < 0.005;
    await imsExecute(
      `UPDATE gift_card_transactions
          SET shopify_transaction_id = ?, shopify_processed_at = ?, provider_balance_after = ?,
              sync_state = 'synced', sync_error = NULL
        WHERE id = ?`,
      [result.transactionId, result.processedAt.slice(0, 19).replace('T', ' '), result.balance, transactionId],
    );
    await imsExecute(
      `UPDATE gift_cards
          SET shopify_observed_balance = ?, reconciliation_state = ?, reconciliation_reason = ?,
              last_reconciled_at = NOW()
        WHERE id = ?`,
      [
        currentProviderBalance,
        balanceMatches ? 'matched' : 'review_required',
        balanceMatches ? null : 'Shopify balance differs after retrying a local gift card transaction.',
        cardId,
      ],
    );
    return NextResponse.json({
      success: true,
      recoveredFromHistory: Boolean(existingProviderTransaction),
      syncState: 'synced',
      providerBalance: currentProviderBalance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await imsExecute(
      "UPDATE gift_card_transactions SET sync_state = 'error', sync_error = ? WHERE id = ?",
      [message.slice(0, 500), transactionId],
    ).catch(() => {});
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify',
      operation: 'gift_card_transaction_retry',
      title: 'Gift card transaction retry failed',
      error,
      context: { cardId, transactionId, shopifyGiftCardId: transaction.shopify_gc_id },
      reference: { type: 'gift_card_transaction', id: transactionId },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function findProviderTransaction(
  transactions: ShopifyGiftCardTransaction[],
  providerNote: string,
  expectedAmount: number,
): { transaction: ShopifyGiftCardTransaction; balanceAfter: number } | null {
  let balanceAfter = 0;
  for (const transaction of [...transactions].sort((left, right) => left.processedAt.localeCompare(right.processedAt))) {
    balanceAfter = Math.round((balanceAfter + transaction.amount) * 100) / 100;
    if (transaction.note === providerNote && Math.abs(transaction.amount - expectedAmount) < 0.005) {
      return { transaction, balanceAfter };
    }
  }
  return null;
}