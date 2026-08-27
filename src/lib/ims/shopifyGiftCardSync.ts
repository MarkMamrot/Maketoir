import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  chooseShopifyGiftCardPlaceholder,
  planObservedBalanceUpdate,
  planShopifyGiftCardImport,
  type ShopifyGiftCardSnapshot,
} from '@/lib/ims/shopifyGiftCardReconciliation';

interface ShopifyGiftCardSnapshotClient {
  getAllGiftCards(status: 'enabled' | 'disabled'): Promise<ShopifyGiftCardSnapshot[]>;
  getGiftCardTransactions?(shopifyGcId: string | number): Promise<{
    balance: number;
    currency: string;
    updatedAt: string;
    enabled: boolean;
    deactivatedAt: string | null;
    transactions: Array<{
      id: string;
      type: 'credit' | 'debit' | 'cash_out' | 'unknown';
      amount: number;
      currency: string;
      processedAt: string;
      note: string | null;
    }>;
  }>;
}

interface ExistingGiftCardRow {
  id: number;
  balance: string | number;
  shopify_observed_balance: string | number | null;
  shopify_updated_at: string | null;
  reconciliation_state: string;
}

export interface ShopifyGiftCardSyncFailure {
  shopifyGiftCardId: string;
  lastCharacters: string | null;
  error: string;
}

export interface ShopifyGiftCardSyncResult {
  success: boolean;
  synced: number;
  inserted: number;
  updated: number;
  reviewRequired: number;
  importedTransactions: number;
  transactionHistoryAvailable: boolean;
  errors: number;
  failures: ShopifyGiftCardSyncFailure[];
  total: number;
}

export async function syncShopifyGiftCardSnapshots(
  businessId: string,
  shopify: ShopifyGiftCardSnapshotClient,
): Promise<ShopifyGiftCardSyncResult> {
  let allCards: ShopifyGiftCardSnapshot[];
  try {
    const [enabled, disabled] = await Promise.all([
      shopify.getAllGiftCards('enabled'),
      shopify.getAllGiftCards('disabled'),
    ]);
    allCards = [...enabled, ...disabled];
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'shopify',
      operation: 'gift_card_reconciliation_fetch',
      title: 'Shopify gift card reconciliation could not fetch cards',
      error,
    });
    throw error;
  }

  let synced = 0;
  let inserted = 0;
  let updated = 0;
  let reviewRequired = 0;
  let importedTransactions = 0;
  let transactionHistoryAvailable = true;
  let transactionHistoryScopeReported = false;
  const failures: ShopifyGiftCardSyncFailure[] = [];

  for (const card of allCards) {
    let shopifyGiftCardId = String(card.id ?? 'unknown');
    try {
      const plan = planShopifyGiftCardImport(card);
      shopifyGiftCardId = plan.shopifyGiftCardId;
      const existingRows = await imsQuery<ExistingGiftCardRow>(
        `SELECT id, balance, shopify_observed_balance, shopify_updated_at, reconciliation_state
           FROM gift_cards WHERE shopify_gc_id = ? LIMIT 1`,
        [plan.shopifyGiftCardId],
      );
      const existingCard = existingRows[0];
      const providerSnapshotChanged = !existingCard
        || !card.updated_at
        || !existingCard.shopify_updated_at
        || normalizeShopifyTimestamp(card.updated_at) !== normalizeShopifyTimestamp(existingCard.shopify_updated_at)
        || existingCard.reconciliation_state !== 'matched';
      let history: Awaited<ReturnType<NonNullable<ShopifyGiftCardSnapshotClient['getGiftCardTransactions']>>> | null = null;
      if (shopify.getGiftCardTransactions && providerSnapshotChanged && transactionHistoryAvailable) {
        try {
          history = await shopify.getGiftCardTransactions(plan.shopifyGiftCardId);
        } catch (error) {
          if (!isGiftCardTransactionScopeError(error)) throw error;
          transactionHistoryAvailable = false;
          if (!transactionHistoryScopeReported) {
            transactionHistoryScopeReported = true;
            await reportRuntimeIssue({
              businessId,
              source: 'shopify',
              operation: 'gift_card_transaction_history_scope',
              title: 'Shopify gift card transaction history is unavailable',
              error,
              context: { requiredScope: 'read_gift_card_transactions' },
            });
          }
        }
      }
      const cardId = existingRows[0]?.id ?? null;
      const knownTransactionRows = cardId && history
        ? await imsQuery<{ shopify_transaction_id: string }>(
            `SELECT shopify_transaction_id
               FROM gift_card_transactions
              WHERE card_id = ? AND shopify_transaction_id IS NOT NULL`,
            [cardId],
          )
        : [];
      const knownTransactionIds = new Set(knownTransactionRows.map(row => row.shopify_transaction_id));
      const unseenTransactions = history?.transactions.filter(transaction => !knownTransactionIds.has(transaction.id)) ?? [];
      const providerBalance = history?.balance ?? plan.balance;
      const providerUpdatedAt = history?.updatedAt ?? card.updated_at ?? null;
      const transactionAmountsForProof = unseenTransactions.every(transaction => transaction.type !== 'unknown')
        ? unseenTransactions.map(transaction => transaction.amount)
        : [];

      if (existingRows.length && history && unseenTransactions.length) {
        await importShopifyTransactions(existingRows[0].id, history.balance, history.transactions, knownTransactionIds);
        importedTransactions += unseenTransactions.length;
      }

      if (existingRows.length) {
        const balanceDecision = planObservedBalanceUpdate({
          localBalance: Number(existingRows[0].balance),
          previousProviderBalance: existingRows[0].shopify_observed_balance == null
            ? null
            : Number(existingRows[0].shopify_observed_balance),
          currentProviderBalance: providerBalance,
          unseenTransactionAmounts: transactionAmountsForProof,
        });
        await imsExecute(
          `UPDATE gift_cards
              SET shopify_line_item_id = ?,
                  initial_balance = IF(initial_balance IS NULL, ?, initial_balance),
                  balance = IF(?, ?, balance),
                  status = ?, currency = ?, expires_on = ?, customer_id = ?, order_id = ?,
                  created_at = COALESCE(?, created_at),
                  shopify_updated_at = ?, shopify_observed_balance = ?, shopify_observed_status = ?,
                  reconciliation_state = ?, reconciliation_reason = ?, last_reconciled_at = NOW()
            WHERE id = ?`,
          [
            plan.lineItemId, plan.initialBalance, balanceDecision.applyProviderBalance ? 1 : 0, providerBalance,
            plan.status, plan.currency, plan.expiresOn, plan.customerId, plan.orderId, plan.createdAt,
            providerUpdatedAt ? normalizeShopifyTimestamp(providerUpdatedAt) : null,
            providerBalance, plan.status, balanceDecision.state, balanceDecision.reason, existingRows[0].id,
          ],
        );
        updated++;
        if (balanceDecision.state === 'review_required') reviewRequired++;
      } else {
        const codeOwnerRows = await imsQuery<{ shopify_gc_id: string | number | null }>(
          'SELECT shopify_gc_id FROM gift_cards WHERE code = ? LIMIT 1',
          [plan.preferredCode],
        );
        const code = chooseShopifyGiftCardPlaceholder(plan, codeOwnerRows[0]?.shopify_gc_id);
        const insertResult = await imsExecute(
          `INSERT INTO gift_cards
             (shopify_gc_id, shopify_line_item_id, code, initial_balance, balance, status,
              currency, expires_on, customer_id, order_id, notes, created_at,
              shopify_updated_at, shopify_observed_balance, shopify_observed_status, reconciliation_state,
              reconciliation_reason, last_reconciled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported from Shopify', ?, ?, ?, ?, ?, NULL, NOW())`,
          [
            plan.shopifyGiftCardId, plan.lineItemId, code, plan.initialBalance, providerBalance,
            plan.status, plan.currency, plan.expiresOn, plan.customerId, plan.orderId, plan.createdAt,
            providerUpdatedAt ? normalizeShopifyTimestamp(providerUpdatedAt) : null,
            providerBalance, plan.status, history ? 'pending' : 'matched',
          ],
        );
        if (history) {
          const newCardId = Number(insertResult.insertId);
          await importShopifyTransactions(newCardId, history.balance, history.transactions, new Set());
          importedTransactions += history.transactions.length;
          await imsExecute(
            "UPDATE gift_cards SET reconciliation_state = 'matched', reconciliation_reason = NULL WHERE id = ?",
            [newCardId],
          );
        }
        inserted++;
      }
      synced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        shopifyGiftCardId,
        lastCharacters: card.last_characters ? String(card.last_characters) : null,
        error: message.slice(0, 300),
      });
      await reportRuntimeIssue({
        businessId,
        source: 'shopify',
        operation: 'gift_card_reconciliation_card',
        title: 'Shopify gift card could not be reconciled',
        error,
        context: { shopifyGiftCardId, lastCharacters: card.last_characters ?? null },
        reference: { type: 'shopify_gift_card', id: shopifyGiftCardId },
      });
    }
  }

  return {
    success: failures.length === 0,
    synced,
    inserted,
    updated,
    reviewRequired,
    importedTransactions,
    transactionHistoryAvailable,
    errors: failures.length,
    failures,
    total: allCards.length,
  };
}

function isGiftCardTransactionScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('read_gift_card_transactions')
    || message.toLowerCase().includes('access denied for nodes field');
}

function normalizeShopifyTimestamp(value: string): string {
  return value.slice(0, 19).replace('T', ' ');
}

async function importShopifyTransactions(
  cardId: number,
  currentProviderBalance: number,
  transactions: Array<{
    id: string;
    type: 'credit' | 'debit' | 'cash_out' | 'unknown';
    amount: number;
    processedAt: string;
    note: string | null;
  }>,
  knownTransactionIds: Set<string>,
): Promise<void> {
  const ordered = [...transactions].sort((left, right) => left.processedAt.localeCompare(right.processedAt));
  const transactionTotal = ordered.reduce((sum, transaction) => sum + transaction.amount, 0);
  let runningBalance = Math.round((currentProviderBalance - transactionTotal) * 100) / 100;
  for (const transaction of ordered) {
    runningBalance = Math.round((runningBalance + transaction.amount) * 100) / 100;
    if (knownTransactionIds.has(transaction.id)) continue;
    await imsExecute(
      `INSERT IGNORE INTO gift_card_transactions
         (card_id, type, amount, balance_after, event_source, shopify_transaction_id,
          shopify_processed_at, provider_balance_after, sync_state, notes)
       VALUES (?, ?, ?, ?, 'shopify', ?, ?, ?, 'imported', ?)`,
      [
        cardId,
        transaction.type === 'debit' || transaction.type === 'cash_out'
          ? 'redeem'
          : transaction.type === 'unknown' ? 'reconcile' : 'adjust',
        transaction.amount,
        runningBalance,
        transaction.id,
        transaction.processedAt.slice(0, 19).replace('T', ' '),
        runningBalance,
        transaction.note,
      ],
    );
  }
}