import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), history: vi.fn(), fetch: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/lib/channels/shopifyGiftCardRecoveryHistory', () => ({
  reconcileShopifyGiftCardHistoryPage: mocks.history, SHOPIFY_GIFT_CARD_HISTORY_PAGE_SIZE: 50,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
import { recoverShopifyGiftCardEffects } from '../shopifyGiftCardRecoveryEffects';

const input = { businessId: 'business-1', channelInstanceId: 'instance-2', beforeCommit: vi.fn(async () => {}) };
const loaded = {
  status: 'enabled' as const, pageInfo: null, pageLoaded: true,
  pendingCardIds: ['11', '12'], nextPageInfo: 'discovery-next', reviewRequired: 0,
};
const checkpoint = {
  cardId: '11', transactionCursor: 'tx-next', sourceVersion: '2026-10-01T01:00:00Z',
  latestTransactionId: 'tip',
  providerBalanceCents: 5000, runningBalanceCents: 6000, unseenAmountCents: -1000,
  baselineLocalBalanceCents: 6000, baselineObservedBalanceCents: 6000, baselineVersion: '2026-09-01 01:00:00',
};
const card = {
  id: 'gid://shopify/GiftCard/11', lastCharacters: 'ABCD', initialValue: { amount: '60' },
  balance: { amount: '50', currencyCode: 'AUD' }, createdAt: '2026-09-01T01:00:00Z',
  updatedAt: '2026-10-01T01:00:00Z', expiresOn: null, deactivatedAt: null, enabled: true,
  customer: null, order: null, lineItem: null,
  transactions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  tip: { nodes: [{ id: 'tip' }] },
};
function reply(data: unknown) {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data })));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.context.mockResolvedValue({ credentials: { shopDomain: 'store.myshopify.com', token: 'secret' } });
  mocks.history.mockResolvedValue({ status: 'completed', checkpoint: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded gift-card recovery orchestration', () => {
  it.each(['enabled', 'disabled'] as const)('cannot mutate or fetch resumed %s work without a guard', async status => {
    expect(await recoverShopifyGiftCardEffects({
      ...input, beforeCommit: undefined as unknown as typeof input.beforeCommit,
      continuation: { ...loaded, status, currentCard: checkpoint },
    })).toMatchObject({ status: 'blocked', reason: 'gift_card_commit_guard_required' });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('discovers only bounded IDs with native provider cursors, without processing histories in the same call', async () => {
    reply({ giftCards: {
      nodes: [{ id: 'gid://shopify/GiftCard/11' }, { id: 'gid://shopify/GiftCard/12' }],
      pageInfo: { hasNextPage: true, endCursor: 'discovery-next' },
    } });
    const result = await recoverShopifyGiftCardEffects(input);
    expect(result).toEqual({
      status: 'pending', continuation: {
        ...loaded, reviewRequired: undefined, currentCard: null,
      }, processed: 0, reviewRequired: 0,
    });
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(request.query).toContain('first: 25');
    expect(request.variables).toEqual({ after: null, query: 'status:enabled OR status:expired OR status:expiring' });
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|ABCD|amount|balance/);
  });

  it('fetches one reverse history page and preserves exact card/cursor checkpoint', async () => {
    reply({ giftCard: card });
    mocks.history.mockResolvedValueOnce({ status: 'pending', checkpoint });
    expect(await recoverShopifyGiftCardEffects({ ...input, continuation: loaded })).toEqual({
      status: 'pending', continuation: { ...loaded, currentCard: checkpoint }, processed: 0, reviewRequired: 0,
    });
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({
      ...input, cardId: '11', page: expect.objectContaining({
        snapshot: expect.objectContaining({ id: '11', balance: '50' }),
      }),
    }));
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(request.query).toContain('first: 50');
    expect(request.query).toContain('reverse: true');
    expect(request.variables).toEqual({ id: 'gid://shopify/GiftCard/11', after: null });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('resumes exact transaction cursor and advances only after card completion', async () => {
    reply({ giftCard: card });
    expect(await recoverShopifyGiftCardEffects({ ...input, continuation: { ...loaded, currentCard: checkpoint } }))
      .toEqual({
        status: 'pending', continuation: { ...loaded, pendingCardIds: ['12'], currentCard: null },
        processed: 1, reviewRequired: 0,
      });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).variables.after).toBe('tx-next');
  });

  it('restarts changed card history without advancing the card queue', async () => {
    reply({ giftCard: card });
    mocks.history.mockResolvedValueOnce({ status: 'restart', checkpoint: null });
    expect(await recoverShopifyGiftCardEffects({ ...input, continuation: { ...loaded, currentCard: checkpoint } }))
      .toEqual({
        status: 'pending', continuation: { ...loaded, currentCard: null }, processed: 0, reviewRequired: 0,
      });
  });

  it('advances reviewed cards/pages and retains final review instead of replaying indefinitely', async () => {
    reply({ giftCard: card });
    mocks.history.mockResolvedValueOnce({ status: 'review', checkpoint: null });
    expect(await recoverShopifyGiftCardEffects({
      ...input, continuation: { ...loaded, pendingCardIds: ['11'] },
    })).toEqual({
      status: 'pending', continuation: { status: 'enabled', pageInfo: 'discovery-next', reviewRequired: 1 },
      processed: 1, reviewRequired: 1,
    });
    reply({ giftCards: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    expect(await recoverShopifyGiftCardEffects({
      ...input, continuation: { status: 'disabled', pageInfo: null, reviewRequired: 1 },
    })).toEqual({
      status: 'blocked', continuation: null, processed: 0, reviewRequired: 1, reason: 'gift_card_review_required',
    });
  });

  it('completes a nonempty storefront after verified histories and both status passes', async () => {
    reply({ giftCard: card });
    expect(await recoverShopifyGiftCardEffects({
      ...input, continuation: { ...loaded, pendingCardIds: ['11'], nextPageInfo: null },
    })).toEqual({
      status: 'pending', continuation: { status: 'disabled', pageInfo: null, reviewRequired: 0 },
      processed: 1, reviewRequired: 0,
    });
    reply({ giftCard: card });
    expect(await recoverShopifyGiftCardEffects({
      ...input, continuation: { ...loaded, status: 'disabled', pendingCardIds: ['11'], nextPageInfo: null },
    })).toEqual({ status: 'completed', continuation: null, processed: 1, reviewRequired: 0 });
  });

  it('reports missing history scope as blocked without discarding the current card', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      errors: [{ message: 'Access denied for transactions field. Required access: read_gift_card_transactions secret' }],
    })));
    expect(await recoverShopifyGiftCardEffects({ ...input, continuation: loaded })).toEqual({
      status: 'blocked', continuation: loaded, processed: 0, reviewRequired: 0, reason: 'gift_card_history_scope_required',
    });
    expect(mocks.history).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('secret');
  });

  it('retries failed imports without advancing the page checkpoint or exposing provider payloads', async () => {
    reply({ giftCard: card });
    mocks.history.mockRejectedValueOnce(new Error('secret raw customer payload'));
    expect(await recoverShopifyGiftCardEffects({ ...input, continuation: loaded })).toEqual({
      status: 'retry', continuation: loaded, processed: 0, reviewRequired: 0, reason: 'gift_card_page_failed',
    });
    expect(JSON.stringify(mocks.report.mock.calls)).not.toMatch(/secret|payload/);
  });

  it('rejects oversized, repeated or invalid discovery pages before history writes', async () => {
    for (const giftCards of [
      { nodes: Array.from({ length: 26 }, () => ({ id: 'gid://shopify/GiftCard/11' })), pageInfo: {} },
      { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
      { nodes: [{ id: 'bad' }], pageInfo: { hasNextPage: false } },
    ]) {
      reply({ giftCards });
      expect(await recoverShopifyGiftCardEffects({
        ...input, continuation: { status: 'enabled', pageInfo: 'same' },
      })).toMatchObject({ status: 'retry' });
    }
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('validates identity and bounded continuation before any provider operation', async () => {
    expect(await recoverShopifyGiftCardEffects({ ...input, channelInstanceId: '' })).toMatchObject({ status: 'blocked' });
    expect(await recoverShopifyGiftCardEffects({
      ...input, continuation: { ...loaded, pendingCardIds: Array.from({ length: 26 }, () => '11') },
    })).toMatchObject({ status: 'blocked' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
