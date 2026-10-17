import { createHash } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  chooseShopifyGiftCardPlaceholder, planObservedBalanceUpdate, planShopifyGiftCardImport,
  type ShopifyGiftCardSnapshot,
} from '@/lib/ims/shopifyGiftCardReconciliation';
import { getIMSPool } from '@/services/IMSMySQLService';

export const SHOPIFY_GIFT_CARD_HISTORY_PAGE_SIZE = 50;

export type ShopifyGiftCardHistoryCheckpoint = {
  cardId: string;
  transactionCursor: string;
  sourceVersion: string;
  latestTransactionId: string | null;
  providerBalanceCents: number;
  runningBalanceCents: number;
  unseenAmountCents: number;
  baselineLocalBalanceCents: number;
  baselineObservedBalanceCents: number | null;
  baselineVersion: string | null;
};

export type ShopifyGiftCardHistoryNode = {
  id: string;
  __typename: string;
  amount: { amount: string; currencyCode: string };
  processedAt: string;
};

export type ShopifyGiftCardHistoryPage = {
  snapshot: ShopifyGiftCardSnapshot;
  transactions: ShopifyGiftCardHistoryNode[];
  hasNextPage: boolean;
  endCursor: string | null;
  latestTransactionId: string | null;
};

export type ShopifyGiftCardHistoryResult =
  | { status: 'pending'; checkpoint: ShopifyGiftCardHistoryCheckpoint }
  | { status: 'restart'; checkpoint: null }
  | { status: 'completed' | 'review'; checkpoint: null };

export type ShopifyGiftCardRecoveryCommitGuard = (
  connection: PoolConnection,
  source: {
    cardId: string;
    sourceVersion: string;
    providerBalanceCents: number;
    latestTransactionId: string | null;
  },
) => Promise<void>;

type CardRow = RowDataPacket & {
  id: number; balance: string | number; shopify_observed_balance: string | number | null;
  shopify_updated_at: string | Date | null;
};

export function shopifyGiftCardTransactionDeltaCents(node: ShopifyGiftCardHistoryNode): number {
  const value = Number(node.amount.amount);
  if (!Number.isFinite(value)) throw new Error('Invalid Shopify gift-card transaction amount.');
  const magnitude = Math.round(Math.abs(value) * 100);
  if (node.__typename === 'GiftCardCreditTransaction') return magnitude;
  if (node.__typename === 'GiftCardDebitTransaction' || node.__typename === 'GiftCardCashOutTransaction') return -magnitude;
  throw new Error('Unsupported Shopify gift-card transaction type.');
}

function stamp(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  return value.slice(0, 19).replace('T', ' ');
}

function cents(value: string | number): number {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid Shopify gift-card balance.');
  return result;
}

async function readCard(connection: PoolConnection, instanceId: string, cardId: string): Promise<CardRow | undefined> {
  const [rows] = await connection.execute<CardRow[]>(
    `SELECT id, balance, shopify_observed_balance, shopify_updated_at FROM gift_cards
      WHERE channel_instance_id = ? AND shopify_gc_id = ? LIMIT 1 FOR UPDATE`,
    [instanceId, cardId],
  );
  return rows[0];
}

// A single provider page and its ledger evidence commit together. Replaying a page after
// a lost job checkpoint counts the same run-marked rows, not just newly inserted rows.
export async function reconcileShopifyGiftCardHistoryPage(input: {
  businessId: string;
  channelInstanceId: string;
  cardId: string;
  checkpoint?: ShopifyGiftCardHistoryCheckpoint | null;
  page: ShopifyGiftCardHistoryPage;
  beforeCommit: ShopifyGiftCardRecoveryCommitGuard;
}): Promise<ShopifyGiftCardHistoryResult> {
  if (typeof input.beforeCommit !== 'function') throw new Error('Shopify gift-card commit guard is required.');
  const { page } = input;
  const plan = planShopifyGiftCardImport(page.snapshot);
  const prior = input.checkpoint;
  if (!input.businessId.trim() || !input.channelInstanceId.trim() || !/^[1-9]\d*$/.test(input.cardId)
    || plan.shopifyGiftCardId !== input.cardId || page.transactions.length > SHOPIFY_GIFT_CARD_HISTORY_PAGE_SIZE
    || typeof page.hasNextPage !== 'boolean' || !Number.isFinite(Number(page.snapshot.balance))
    || Number(page.snapshot.balance) < 0
    || !page.snapshot.updated_at || !Number.isFinite(Date.parse(page.snapshot.updated_at))
    || (page.hasNextPage && (!page.endCursor || page.endCursor.length > 4096
      || page.endCursor === prior?.transactionCursor || !page.transactions.length))
    || (prior && (!prior.transactionCursor || prior.transactionCursor.length > 4096
      || ![prior.providerBalanceCents, prior.runningBalanceCents, prior.unseenAmountCents, prior.baselineLocalBalanceCents]
        .every(Number.isSafeInteger)
      || (prior.baselineObservedBalanceCents !== null && !Number.isSafeInteger(prior.baselineObservedBalanceCents))))) {
    throw new Error('Invalid Shopify gift-card history page.');
  }
  const version = page.snapshot.updated_at;
  const providerCents = cents(plan.balance);
  if (input.checkpoint && (input.checkpoint.cardId !== input.cardId
    || input.checkpoint.sourceVersion !== version || input.checkpoint.providerBalanceCents !== providerCents
    || input.checkpoint.latestTransactionId !== page.latestTransactionId)) {
    return { status: 'restart', checkpoint: null };
  }
  const unsupported = page.transactions.some(node => ![
    'GiftCardCreditTransaction', 'GiftCardDebitTransaction', 'GiftCardCashOutTransaction',
  ].includes(node.__typename));
  const connection = await getIMSPool().getConnection();
  const assertCurrent = () => input.beforeCommit(connection, {
    cardId: input.cardId, sourceVersion: version, providerBalanceCents: providerCents,
    latestTransactionId: page.latestTransactionId,
  });
  const commit = async () => {
    await assertCurrent();
    await connection.commit();
  };
  try {
    await connection.beginTransaction();
    await assertCurrent();
    let card = await readCard(connection, input.channelInstanceId, input.cardId);
    if (!card) {
      if (input.checkpoint) throw new Error('Shopify gift-card checkpoint lost its local card.');
      const [owners] = await connection.execute<(RowDataPacket & { shopify_gc_id: string | null })[]>(
        'SELECT shopify_gc_id FROM gift_cards WHERE channel_instance_id = ? AND code = ? LIMIT 1',
        [input.channelInstanceId, plan.preferredCode],
      );
      const code = chooseShopifyGiftCardPlaceholder(plan, owners[0]?.shopify_gc_id);
      await connection.execute(
        `INSERT INTO gift_cards
          (channel_instance_id, shopify_gc_id, shopify_line_item_id, code, initial_balance, balance,
           status, currency, expires_on, customer_id, order_id, created_at, reconciliation_state, reconciliation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'Shopify transaction history is being verified.')`,
        [input.channelInstanceId, input.cardId, plan.lineItemId, code, plan.initialBalance, plan.balance,
          plan.status, plan.currency, plan.expiresOn, plan.customerId, plan.orderId, plan.createdAt],
      );
      card = await readCard(connection, input.channelInstanceId, input.cardId);
      if (!card) throw new Error('Shopify gift card could not be imported.');
    }
    if (unsupported) {
      await connection.execute(
        `UPDATE gift_cards SET reconciliation_state = 'review_required',
          reconciliation_reason = 'Shopify transaction history contains an unsupported transaction type.'
          WHERE id = ? AND channel_instance_id = ?`,
        [card.id, input.channelInstanceId],
      );
      await commit();
      return { status: 'review', checkpoint: null };
    }
    const checkpoint = input.checkpoint ?? {
      cardId: input.cardId, transactionCursor: '', sourceVersion: version,
      latestTransactionId: page.latestTransactionId,
      providerBalanceCents: providerCents, runningBalanceCents: providerCents, unseenAmountCents: 0,
      baselineLocalBalanceCents: cents(card.balance),
      baselineObservedBalanceCents: card.shopify_observed_balance == null ? null : cents(card.shopify_observed_balance),
      baselineVersion: stamp(card.shopify_updated_at),
    };
    const baselineKey = createHash('sha256').update(JSON.stringify([
      input.businessId, input.channelInstanceId, input.cardId,
      checkpoint.baselineVersion, checkpoint.baselineObservedBalanceCents, checkpoint.baselineLocalBalanceCents,
    ])).digest('hex');
    const sourceKey = createHash('sha256').update(JSON.stringify([version, page.latestTransactionId, providerCents]))
      .digest('hex').slice(0, 24);
    const pageKey = createHash('sha256').update(input.checkpoint?.transactionCursor ?? 'first').digest('hex').slice(0, 24);
    const runKey = `${baselineKey}:${sourceKey}:${pageKey}`;
    const ids = page.transactions.flatMap(node => [node.id, `${input.channelInstanceId}:${node.id}`]);
    const [knownRows] = ids.length
      ? await connection.execute<(RowDataPacket & {
        card_id: number; amount: number | string; shopify_transaction_id: string; reference_type: string | null; reference_id: string | null;
      })[]>(
        `SELECT card_id, amount, shopify_transaction_id, reference_type, reference_id FROM gift_card_transactions
          WHERE shopify_transaction_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      ) : [[]];
    if (knownRows.some(row => Number(row.card_id) !== Number(card.id))) {
      throw new Error('Shopify transaction identity belongs to another local card.');
    }
    const known = new Map(knownRows.map(row => [row.shopify_transaction_id, row]));
    let runningBalanceCents = checkpoint.runningBalanceCents;
    let unseenAmountCents = checkpoint.unseenAmountCents;
    const seen = new Set<string>();
    for (const node of page.transactions) {
      if (typeof node.id !== 'string' || !node.id || node.id.length + input.channelInstanceId.length + 1 > 191 || seen.has(node.id)
        || node.amount.currencyCode !== plan.currency || !Number.isFinite(Date.parse(node.processedAt))) {
        throw new Error('Invalid Shopify gift-card transaction evidence.');
      }
      seen.add(node.id);
      const delta = shopifyGiftCardTransactionDeltaCents(node);
      const identity = `${input.channelInstanceId}:${node.id}`;
      const existing = known.get(identity) ?? known.get(node.id);
      if (existing && (cents(existing.amount) !== delta
        || (existing.reference_type === 'shopify_recovery'
          && existing.reference_id?.startsWith(`${baselineKey}:${sourceKey}:`) && existing.reference_id !== runKey))) {
        throw new Error('Shopify gift-card transaction evidence changed or repeated across pages.');
      }
      if (!existing || (existing.reference_type === 'shopify_recovery' && existing.reference_id?.startsWith(`${baselineKey}:`))) {
        unseenAmountCents += delta;
      }
      if (!existing) {
        await connection.execute(
          `INSERT INTO gift_card_transactions
            (card_id, type, amount, balance_after, event_source, shopify_transaction_id,
             shopify_processed_at, provider_balance_after, sync_state, reference_type, reference_id, notes)
           VALUES (?, ?, ?, ?, 'shopify', ?, ?, ?, 'imported', 'shopify_recovery', ?, 'Imported from Shopify recovery')`,
          [card.id, delta < 0 ? 'redeem' : 'adjust', delta / 100, runningBalanceCents / 100,
            identity, stamp(node.processedAt), runningBalanceCents / 100, runKey],
        );
      }
      runningBalanceCents -= delta;
      if (!Number.isSafeInteger(runningBalanceCents) || !Number.isSafeInteger(unseenAmountCents)) {
        throw new Error('Shopify gift-card history exceeded numeric bounds.');
      }
    }
    if (page.hasNextPage) {
      await connection.execute(
        `UPDATE gift_cards SET reconciliation_state = 'pending',
          reconciliation_reason = 'Shopify transaction history is being verified.'
          WHERE id = ? AND channel_instance_id = ?`,
        [card.id, input.channelInstanceId],
      );
      await commit();
      return {
        status: 'pending', checkpoint: {
          ...checkpoint, transactionCursor: page.endCursor!, runningBalanceCents, unseenAmountCents,
        },
      };
    }
    const baselineStable = cents(card.balance) === checkpoint.baselineLocalBalanceCents
      && (card.shopify_observed_balance == null ? null : cents(card.shopify_observed_balance)) === checkpoint.baselineObservedBalanceCents
      && stamp(card.shopify_updated_at) === checkpoint.baselineVersion;
    const decision = planObservedBalanceUpdate({
      localBalance: Number(card.balance),
      previousProviderBalance: baselineStable && checkpoint.baselineObservedBalanceCents != null
        ? checkpoint.baselineObservedBalanceCents / 100 : null,
      currentProviderBalance: plan.balance,
      unseenTransactionAmounts: baselineStable ? [unseenAmountCents / 100] : [],
    });
    await connection.execute(
      `UPDATE gift_cards SET shopify_line_item_id = ?, initial_balance = COALESCE(initial_balance, ?),
        balance = IF(?, ?, balance), status = ?, currency = ?, expires_on = ?, customer_id = ?, order_id = ?,
        shopify_updated_at = ?, shopify_observed_balance = ?, shopify_observed_status = ?,
        reconciliation_state = ?, reconciliation_reason = ?, last_reconciled_at = NOW()
        WHERE id = ? AND channel_instance_id = ?`,
      [plan.lineItemId, plan.initialBalance, decision.applyProviderBalance ? 1 : 0, plan.balance,
        plan.status, plan.currency, plan.expiresOn, plan.customerId, plan.orderId, stamp(version), plan.balance,
        plan.status, decision.state, decision.reason, card.id, input.channelInstanceId],
    );
    await commit();
    return { status: decision.state === 'matched' ? 'completed' : 'review', checkpoint: null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
