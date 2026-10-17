import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.pool }));
import {
  reconcileShopifyGiftCardHistoryPage, shopifyGiftCardTransactionDeltaCents,
  type ShopifyGiftCardHistoryNode, type ShopifyGiftCardHistoryPage,
} from '../shopifyGiftCardRecoveryHistory';

const identity = {
  businessId: 'business-1', channelInstanceId: 'instance-2', cardId: '11',
  beforeCommit: vi.fn(async () => {}),
};
function node(id: string, type: string, amount: string): ShopifyGiftCardHistoryNode {
  return { id, __typename: type, amount: { amount, currencyCode: 'AUD' }, processedAt: '2026-10-01T01:00:00Z' };
}
function page(transactions: ShopifyGiftCardHistoryNode[], hasNextPage = false): ShopifyGiftCardHistoryPage {
  return {
    snapshot: {
      id: '11', balance: '70', initial_value: '100', currency: 'AUD', last_characters: 'ABCD',
      updated_at: '2026-10-01T01:00:00Z', created_at: '2026-09-01T01:00:00Z',
    }, transactions, hasNextPage, endCursor: hasNextPage ? 'next' : null, latestTransactionId: 'tip',
  };
}
type Tx = {
  card_id: number; shopify_transaction_id: string; reference_type: string | null; reference_id: string | null;
  amount: number; balance_after: number;
};
let card: { id: number; balance: number; shopify_observed_balance: number | null; shopify_updated_at: string | null };
let transactions: Tx[];
let lastState: string | undefined;
const connection = {
  beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  card = { id: 1, balance: 100, shopify_observed_balance: 100, shopify_updated_at: '2026-09-01 01:00:00' };
  transactions = [];
  lastState = undefined;
  mocks.pool.mockReturnValue({ getConnection: async () => connection });
  connection.execute.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM gift_cards') && sql.includes('FOR UPDATE')) return [[{ ...card }]];
    if (sql.includes('FROM gift_card_transactions')) {
      return [transactions.filter(tx => args.includes(tx.shopify_transaction_id)).map(tx => ({ ...tx }))];
    }
    if (sql.includes('INSERT INTO gift_card_transactions')) {
      if (transactions.some(tx => tx.shopify_transaction_id === args[4])) throw new Error('Duplicate transaction');
      transactions.push({
        card_id: Number(args[0]), amount: Number(args[2]), balance_after: Number(args[3]),
        shopify_transaction_id: String(args[4]), reference_type: 'shopify_recovery', reference_id: String(args[7]),
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE gift_cards SET shopify_line_item_id')) {
      if (args[2]) card.balance = Number(args[3]);
      card.shopify_updated_at = String(args[9]);
      card.shopify_observed_balance = Number(args[10]);
      lastState = String(args[12]);
    } else if (sql.includes("reconciliation_state = 'pending'")) lastState = 'pending';
    else if (sql.includes("reconciliation_state = 'review_required'")) lastState = 'review_required';
    return [{ affectedRows: 1 }];
  });
});

describe('gift-card history bounded ledger reconciliation', () => {
  it('rejects a missing guard before opening a tenant connection', async () => {
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, beforeCommit: undefined as unknown as typeof identity.beforeCommit, page: page([]),
    })).rejects.toThrow('guard is required');
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it('asserts ownership before the first SQL statement and again after all writes before commit', async () => {
    await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit', 'GiftCardDebitTransaction', '30')]),
    });
    expect(identity.beforeCommit).toHaveBeenCalledTimes(2);
    expect(connection.beginTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(identity.beforeCommit.mock.invocationCallOrder[0]);
    expect(identity.beforeCommit.mock.invocationCallOrder[0])
      .toBeLessThan(connection.execute.mock.invocationCallOrder[0]);
    expect(connection.execute.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(identity.beforeCommit.mock.invocationCallOrder[1]);
    expect(identity.beforeCommit.mock.invocationCallOrder[1])
      .toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it('does not perform any card/ledger SQL when the initial guard rejects expired ownership', async () => {
    identity.beforeCommit.mockRejectedValueOnce(new Error('Expired ownership'));
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit', 'GiftCardDebitTransaction', '30')]),
    })).rejects.toThrow('Expired ownership');
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['GiftCardCreditTransaction', '-10.25', 1025],
    ['GiftCardDebitTransaction', '10.25', -1025],
    ['GiftCardDebitTransaction', '-10.25', -1025],
    ['GiftCardCashOutTransaction', '10.25', -1025],
  ])('normalizes %s amount %s to signed minor units', (type, amount, expected) => {
    expect(shopifyGiftCardTransactionDeltaCents(node('a', type, amount))).toBe(expected);
  });

  it('imports native reverse pages and applies only the fully proven unseen change', async () => {
    const first = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });

    expect(first.status).toBe('pending');
    expect(card.balance).toBe(100);
    expect(card.shopify_observed_balance).toBe(100);
    expect(transactions[0]).toMatchObject({
      shopify_transaction_id: 'instance-2:debit-2', amount: -20, balance_after: 70,
    });
    if (first.status !== 'pending') throw new Error('Expected checkpoint');
    const second = await reconcileShopifyGiftCardHistoryPage({
      ...identity, checkpoint: first.checkpoint, page: page([node('debit-1', 'GiftCardDebitTransaction', '10')]),
    });
    expect(second).toEqual({ status: 'completed', checkpoint: null });
    expect(transactions[1].balance_after).toBe(90);
    expect(card.balance).toBe(70);
    expect(card.shopify_observed_balance).toBe(70);
    expect(lastState).toBe('matched');
  });

  it('replays a committed page after lost job checkpoint without losing unseen delta or duplicating ledger rows', async () => {
    const input = { ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true) };
    const first = await reconcileShopifyGiftCardHistoryPage(input);
    const replay = await reconcileShopifyGiftCardHistoryPage(input);
    expect(replay).toEqual(first);
    expect(transactions).toHaveLength(1);
    if (replay.status !== 'pending') throw new Error('Expected checkpoint');
    expect(await reconcileShopifyGiftCardHistoryPage({
      ...identity, checkpoint: replay.checkpoint, page: page([node('debit-1', 'GiftCardDebitTransaction', '10')]),
    })).toEqual({ status: 'completed', checkpoint: null });
    expect(card.balance).toBe(70);
  });

  it('accepts legacy/raw transaction evidence without double importing or treating it as unseen', async () => {
    card.balance = 80;
    card.shopify_observed_balance = 80;
    transactions.push({
      card_id: 1, shopify_transaction_id: 'old', reference_type: null, reference_id: null, amount: -20, balance_after: 80,
    });
    const result = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([
        node('new', 'GiftCardDebitTransaction', '10'), node('old', 'GiftCardDebitTransaction', '20'),
      ]),
    });
    expect(result.status).toBe('completed');
    expect(transactions).toHaveLength(2);
    expect(card.balance).toBe(70);
    const query = connection.execute.mock.calls.find(([sql]) => sql.includes('FROM gift_card_transactions'))!;
    expect(query[0]).toContain(' IN (');
    expect(query[1]).toEqual(['new', 'instance-2:new', 'old', 'instance-2:old']);
  });

  it('preserves local balances when provider history does not prove the full change', async () => {
    expect(await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit', 'GiftCardDebitTransaction', '20')]),
    })).toEqual({ status: 'review', checkpoint: null });
    expect(card.balance).toBe(100);
    expect(card.shopify_observed_balance).toBe(70);
    expect(lastState).toBe('review_required');
  });

  it('does not overwrite a concurrent local adjustment during a multi-page history scan', async () => {
    const first = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });
    if (first.status !== 'pending') throw new Error('Expected checkpoint');
    card.balance = 105;
    expect(await reconcileShopifyGiftCardHistoryPage({
      ...identity, checkpoint: first.checkpoint, page: page([node('debit-1', 'GiftCardDebitTransaction', '10')]),
    })).toEqual({ status: 'review', checkpoint: null });
    expect(card.balance).toBe(105);
  });

  it('restarts changed source versions before importing another page', async () => {
    const first = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });

    if (first.status !== 'pending') throw new Error('Expected checkpoint');
    const next = page([node('debit-1', 'GiftCardDebitTransaction', '10')]);
    next.snapshot.updated_at = '2026-10-01T02:00:00Z';
    expect(await reconcileShopifyGiftCardHistoryPage({ ...identity, checkpoint: first.checkpoint, page: next }))
      .toEqual({ status: 'restart', checkpoint: null });
    expect(transactions).toHaveLength(1);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('marks unknown transaction types as explicit review without fabricating ledger amounts', async () => {
    expect(await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('unknown', 'FutureGiftCardTransaction', '10')]),
    })).toEqual({ status: 'review', checkpoint: null });
    expect(transactions).toHaveLength(0);
    expect(lastState).toBe('review_required');
  });

  it('rejects page overflow/repeated cursors, currency mismatches and foreign transaction ownership', async () => {
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page(Array.from({ length: 51 }, (_, i) => node(String(i), 'GiftCardDebitTransaction', '1'))),
    })).rejects.toThrow('page');
    const foreign = node('foreign', 'GiftCardDebitTransaction', '30');
    foreign.amount.currencyCode = 'USD';
    await expect(reconcileShopifyGiftCardHistoryPage({ ...identity, page: page([foreign]) })).rejects.toThrow('evidence');
    transactions.push({
      card_id: 99, shopify_transaction_id: 'foreign', reference_type: null, reference_id: null, amount: -30, balance_after: 70,
    });
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('foreign', 'GiftCardDebitTransaction', '30')]),
    })).rejects.toThrow('another local card');
    expect(connection.rollback).toHaveBeenCalledTimes(2);
  });

  it('rolls back ledger failures and always releases the tenant connection', async () => {
    connection.execute.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([]),
    })).rejects.toThrow('database unavailable');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('imports a missing provider card once and completes its full transaction evidence', async () => {
    card.balance = 70;
    card.shopify_observed_balance = null;
    card.shopify_updated_at = null;
    connection.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    expect(await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit', 'GiftCardDebitTransaction', '30')]),
    })).toEqual({ status: 'completed', checkpoint: null });
    const insert = connection.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO gift_cards'))!;
    expect(insert[1]).toEqual([
      'instance-2', '11', null, 'SHOPIFY:ABCD', 100, 70, 'active', 'AUD',
      null, null, null, '2026-09-01 01:00:00',
    ]);
    expect(transactions).toHaveLength(1);
    expect(lastState).toBe('matched');
  });

  it('retains durable unseen imports when a changing provider card restarts from page one', async () => {
    await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });
    const changed = page([
      node('debit-2', 'GiftCardDebitTransaction', '20'), node('debit-1', 'GiftCardDebitTransaction', '10'),
    ]);
    changed.snapshot.updated_at = '2026-10-01T02:00:00Z';
    expect(await reconcileShopifyGiftCardHistoryPage({ ...identity, page: changed }))
      .toEqual({ status: 'completed', checkpoint: null });
    expect(transactions).toHaveLength(2);
    expect(card.balance).toBe(70);
  });

  it('restarts when the history tip changes even if timestamps and balance are unchanged', async () => {
    const first = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });
    if (first.status !== 'pending') throw new Error('Expected checkpoint');
    const changed = page([node('debit-1', 'GiftCardDebitTransaction', '10')]);
    changed.latestTransactionId = 'new-same-second-transaction';
    expect(await reconcileShopifyGiftCardHistoryPage({ ...identity, checkpoint: first.checkpoint, page: changed }))
      .toEqual({ status: 'restart', checkpoint: null });
    expect(transactions).toHaveLength(1);
  });

  it('replays a final committed page without duplicate writes after a lost final job checkpoint', async () => {
    const input = { ...identity, page: page([node('debit', 'GiftCardDebitTransaction', '30')]) };
    expect(await reconcileShopifyGiftCardHistoryPage(input)).toEqual({ status: 'completed', checkpoint: null });
    expect(await reconcileShopifyGiftCardHistoryPage(input)).toEqual({ status: 'completed', checkpoint: null });
    expect(transactions).toHaveLength(1);
    expect(card.balance).toBe(70);
  });

  it('rejects the same transaction repeated on a different page of an unchanged source', async () => {
    const first = await reconcileShopifyGiftCardHistoryPage({
      ...identity, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')], true),
    });
    if (first.status !== 'pending') throw new Error('Expected checkpoint');
    await expect(reconcileShopifyGiftCardHistoryPage({
      ...identity, checkpoint: first.checkpoint, page: page([node('debit-2', 'GiftCardDebitTransaction', '20')]),
    })).rejects.toThrow('repeated');
    expect(transactions).toHaveLength(1);
    expect(card.balance).toBe(100);
  });
});
