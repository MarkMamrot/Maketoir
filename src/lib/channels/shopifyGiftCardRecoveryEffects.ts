import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import {
  reconcileShopifyGiftCardHistoryPage, SHOPIFY_GIFT_CARD_HISTORY_PAGE_SIZE,
  type ShopifyGiftCardHistoryCheckpoint, type ShopifyGiftCardHistoryNode,
  type ShopifyGiftCardRecoveryCommitGuard,
} from '@/lib/channels/shopifyGiftCardRecoveryHistory';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { validateReconciliationWindow, type ReconciliationWindow } from './onlineSyncPolicy';

export type ShopifyGiftCardRecoveryContinuation = {
  status: 'enabled' | 'disabled';
  pageInfo: string | null;
  pendingCardIds?: string[];
  nextPageInfo?: string | null;
  pageLoaded?: boolean;
  currentCard?: ShopifyGiftCardHistoryCheckpoint | null;
  reviewRequired?: number;
};

type Counts = { processed: number; reviewRequired: number };
export type ShopifyGiftCardRecoveryResult = Counts & (
  | { status: 'completed'; continuation: null }
  | { status: 'pending'; continuation: ShopifyGiftCardRecoveryContinuation }
  | { status: 'blocked'; continuation: ShopifyGiftCardRecoveryContinuation | null; reason: string }
  | { status: 'retry'; continuation: ShopifyGiftCardRecoveryContinuation; reason: string }
);

export const SHOPIFY_GIFT_CARD_RECOVERY_PAGE_SIZE = 25;

function validToken(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.length > 0 && value.length <= 4096);
}

function externalId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const id = value.split('/').pop() ?? '';
  return /^[1-9]\d*$/.test(id) ? id : null;
}

class GiftCardScopeError extends Error {}

async function graphql<T>(credentials: { shopDomain: string; token: string }, query: string, variables: object): Promise<T> {
  const response = await fetch(`https://${credentials.shopDomain}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': credentials.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Shopify gift-card page is unavailable.');
  const body = await response.json();
  if (Array.isArray(body.errors) && body.errors.length) {
    if (body.errors.some((error: { message?: string }) =>
      /read_gift_card_transactions|access denied for (?:nodes|transactions) field/i.test(error.message ?? ''))) {
      throw new GiftCardScopeError('Shopify gift-card transaction-history permission is required.');
    }
    throw new Error('Shopify gift-card query failed.');
  }
  if (!body.data) throw new Error('Shopify gift-card query returned no data.');
  return body.data;
}

// One native discovery page OR one card's native transaction page per invocation.
// The parent persists this ID/cursor/version/numeric checkpoint, never provider payloads.
export async function recoverShopifyGiftCardEffects(input: {
  businessId: string;
  channelInstanceId: string;
  continuation?: ShopifyGiftCardRecoveryContinuation | null;
  window: ReconciliationWindow;
  beforeCommit: ShopifyGiftCardRecoveryCommitGuard;
}): Promise<ShopifyGiftCardRecoveryResult> {
  const cursor = input.continuation ?? { status: 'enabled', pageInfo: null };
  const reviewRequired = cursor.reviewRequired ?? 0;
  const unfinished = (status: 'blocked' | 'retry', reason: string): ShopifyGiftCardRecoveryResult => ({
    status, continuation: cursor, processed: 0, reviewRequired, reason,
  });
  if (typeof input.beforeCommit !== 'function') return unfinished('blocked', 'gift_card_commit_guard_required');
  if (!input.businessId.trim() || !input.channelInstanceId.trim()
    || !['enabled', 'disabled'].includes(cursor.status) || !validToken(cursor.pageInfo)
    || !validToken(cursor.nextPageInfo) || !Number.isSafeInteger(reviewRequired) || reviewRequired < 0
    || (cursor.pendingCardIds && (cursor.pendingCardIds.length > SHOPIFY_GIFT_CARD_RECOVERY_PAGE_SIZE
      || cursor.pendingCardIds.some(id => !/^[1-9]\d*$/.test(id))))
    || (cursor.currentCard && (!validToken(cursor.currentCard.transactionCursor)
      || cursor.currentCard.cardId !== cursor.pendingCardIds?.[0]))) {
    return unfinished('blocked', 'invalid_gift_card_continuation');
  }
  const advance = (next: string | null, reviews: number, processed: number): ShopifyGiftCardRecoveryResult => {
    if (next) return {
      status: 'pending', continuation: { status: cursor.status, pageInfo: next, reviewRequired: reviews },
      processed, reviewRequired: reviews,
    };
    if (cursor.status === 'enabled') return {
      status: 'pending', continuation: { status: 'disabled', pageInfo: null, reviewRequired: reviews },
      processed, reviewRequired: reviews,
    };
    return reviews
      ? { status: 'blocked', continuation: null, processed, reviewRequired: reviews, reason: 'gift_card_review_required' }
      : { status: 'completed', continuation: null, processed, reviewRequired: 0 };
  };
  try {
    const window = validateReconciliationWindow(input.window);
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    const context = await getShopifyOperationContext({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId,
    });
    if (!cursor.pageLoaded) {
      const data = await graphql<{
        giftCards: { nodes: Array<{ id: string; updatedAt: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      }>(context.credentials, `query RecoveryGiftCards($after: String, $query: String!) {
        giftCards(first: ${SHOPIFY_GIFT_CARD_RECOVERY_PAGE_SIZE}, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          nodes { id updatedAt } pageInfo { hasNextPage endCursor }
        }
      }`, {
        after: cursor.pageInfo,
        query: cursor.status === 'enabled' ? 'status:enabled OR status:expired OR status:expiring' : 'status:disabled',
      });
      const page = data.giftCards;
      if (!page || !Array.isArray(page.nodes) || page.nodes.length > SHOPIFY_GIFT_CARD_RECOVERY_PAGE_SIZE
        || !page.pageInfo || typeof page.pageInfo.hasNextPage !== 'boolean' || (page.pageInfo.hasNextPage
          && (!validToken(page.pageInfo.endCursor) || !page.pageInfo.endCursor || page.pageInfo.endCursor === cursor.pageInfo))) {
        throw new Error('Invalid Shopify gift-card discovery page.');
      }
      const identities = page.nodes.map(node => externalId(node.id));
      const updated = page.nodes.map(node => Date.parse(node.updatedAt));
      if (identities.some(id => id == null) || new Set(identities).size !== identities.length
        || updated.some((value, index) => !Number.isFinite(value) || (index > 0 && value > updated[index - 1]))) {
        throw new Error('Invalid Shopify gift-card discovery identities or update order.');
      }
      const ids = identities.filter((id, index): id is string => id !== null && updated[index] >= from && updated[index] <= to);
      const next = !updated.some(value => value < from) && page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      if (!ids.length) return advance(next, reviewRequired, 0);
      return {
        status: 'pending', continuation: {
          ...cursor, pageLoaded: true, pendingCardIds: ids as string[], nextPageInfo: next, currentCard: null,
        }, processed: 0, reviewRequired,
      };
    }
    const cardId = cursor.pendingCardIds?.[0];
    if (!cardId) return unfinished('blocked', 'invalid_gift_card_continuation');
    const data = await graphql<{
      giftCard: {
        id: string; lastCharacters: string; initialValue: { amount: string };
        balance: { amount: string; currencyCode: string }; createdAt: string; updatedAt: string;
        expiresOn: string | null; deactivatedAt: string | null; enabled: boolean;
        customer: { id: string } | null; order: { id: string } | null; lineItem: { id: string } | null;
        transactions: { nodes: ShopifyGiftCardHistoryNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        tip: { nodes: Array<{ id: string }> };
      } | null;
    }>(context.credentials, `query RecoveryGiftCardHistory($id: ID!, $after: String) {
      giftCard(id: $id) {
        id lastCharacters initialValue { amount } balance { amount currencyCode } createdAt updatedAt
        expiresOn deactivatedAt enabled customer { id } order { id } lineItem { id }
        transactions(first: ${SHOPIFY_GIFT_CARD_HISTORY_PAGE_SIZE}, after: $after, reverse: true) {
          nodes { id __typename amount { amount currencyCode } processedAt } pageInfo { hasNextPage endCursor }
        }
        tip: transactions(first: 1, reverse: true) { nodes { id } }
      }
    }`, { id: `gid://shopify/GiftCard/${cardId}`, after: cursor.currentCard?.transactionCursor ?? null });
    const card = data.giftCard;
    if (!card || externalId(card.id) !== cardId || !card.transactions
      || !Array.isArray(card.transactions.nodes) || !card.transactions.pageInfo
      || !card.tip || !Array.isArray(card.tip.nodes) || card.tip.nodes.length > 1) {
      throw new Error('Incomplete Shopify gift-card transaction history.');
    }
    const updatedAt = Date.parse(card.updatedAt);
    if (!Number.isFinite(updatedAt)) throw new Error('Invalid Shopify gift-card update timestamp.');
    if (updatedAt < from || updatedAt > to) {
      const remaining = cursor.pendingCardIds!.slice(1);
      return remaining.length ? {
        status: 'pending', continuation: { ...cursor, pendingCardIds: remaining, currentCard: null },
        processed: 1, reviewRequired,
      } : advance(cursor.nextPageInfo ?? null, reviewRequired, 1);
    }
    const result = await reconcileShopifyGiftCardHistoryPage({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, cardId, checkpoint: cursor.currentCard,
      beforeCommit: input.beforeCommit,
      page: {
        snapshot: {
          id: cardId, last_characters: card.lastCharacters, initial_value: card.initialValue.amount,
          balance: card.balance.amount, currency: card.balance.currencyCode, created_at: card.createdAt,
          updated_at: card.updatedAt, expires_on: card.expiresOn,
          disabled_at: card.deactivatedAt ?? (card.enabled ? null : card.updatedAt),
          customer_id: externalId(card.customer?.id), order_id: externalId(card.order?.id),
          line_item_id: externalId(card.lineItem?.id),
        },
        transactions: card.transactions.nodes, ...card.transactions.pageInfo,
        latestTransactionId: card.tip.nodes[0]?.id ?? null,
      },
    });
    if (result.status === 'pending' || result.status === 'restart') return {
      status: 'pending', continuation: { ...cursor, currentCard: result.checkpoint }, processed: 0, reviewRequired,
    };
    const reviews = reviewRequired + (result.status === 'review' ? 1 : 0);
    const remaining = cursor.pendingCardIds!.slice(1);
    if (!remaining.length) return advance(cursor.nextPageInfo ?? null, reviews, 1);
    return {
      status: 'pending', continuation: {
        ...cursor, pendingCardIds: remaining, currentCard: null, reviewRequired: reviews,
      }, processed: 1, reviewRequired: reviews,
    };
  } catch (error) {
    const missingScope = error instanceof GiftCardScopeError;
    await reportRuntimeIssue({
      businessId: input.businessId, source: 'shopify_recovery', operation: 'gift_card_page_recovery',
      title: 'Shopify gift-card recovery page is unfinished',
      error: new Error(missingScope ? 'Shopify read_gift_card_transactions permission is required.' : 'Shopify gift-card page recovery failed.'),
      context: { channelInstanceId: input.channelInstanceId, status: cursor.status, cardId: cursor.pendingCardIds?.[0] ?? null },
    });
    return unfinished(missingScope ? 'blocked' : 'retry', missingScope ? 'gift_card_history_scope_required' : 'gift_card_page_failed');
  }
}
