import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mainQuery: vi.fn(), context: vi.fn(), report: vi.fn(), fetch: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('Unexpected non-tenant database/provider access.'); }),
}));
vi.mock('@/services/MySQLService', () => ({
  query: mocks.mainQuery, execute: mocks.forbidden, getPool: mocks.forbidden,
}));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { parseSchemaStatements } from '@/lib/ims/provisionBusiness';
import { runImsForBusiness, invalidateImsDbCache } from '@/lib/db/BusinessRegistry';
import { getIMSPool } from '@/services/IMSMySQLService';
import { recoverShopifyGiftCardEffects } from '../shopifyGiftCardRecoveryEffects';
import { parseShopifyGiftCardRecoveryContinuation } from '../shopifyGiftCardRecoveryCheckpoint';
import {
  reconcileShopifyGiftCardHistoryPage, type ShopifyGiftCardHistoryPage, type ShopifyGiftCardHistoryNode,
  type ShopifyGiftCardRecoveryCommitGuard,
} from '../shopifyGiftCardRecoveryHistory';

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `gift_recovery_test_${randomUUID().replaceAll('-', '')}`;
const businessId = `gift-${randomUUID()}`;
const channelInstanceId = randomUUID();
const leaseToken = randomUUID();
const identity = { businessId, channelInstanceId, cardId: '123', beforeCommit: assertLease };
const window = { phase: 'baseline' as const, from: '2026-10-10T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' };
let pool: Pool | undefined;
let created = false;

function transaction(id: string, amount: string): ShopifyGiftCardHistoryNode {
  return {
    id: `gid://shopify/GiftCardDebitTransaction/${id}`,
    __typename: 'GiftCardDebitTransaction',
    amount: { amount, currencyCode: 'AUD' },
    processedAt: '2026-10-17T01:00:00Z',
  };
}

function page(transactions: ShopifyGiftCardHistoryNode[], hasNextPage = false): ShopifyGiftCardHistoryPage {
  return {
    snapshot: {
      id: '123', last_characters: 'ABCD', initial_value: '100.00', balance: '70.00',
      currency: 'AUD', created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-17T01:00:00Z',
    },
    transactions, hasNextPage, endCursor: hasNextPage ? 'cursor123' : null,
    latestTransactionId: 'gid://shopify/GiftCardDebitTransaction/999',
  };
}

async function state() {
  const [cards] = await pool!.query<RowDataPacket[]>(
    'SELECT balance, shopify_observed_balance, reconciliation_state FROM gift_cards WHERE channel_instance_id = ? AND shopify_gc_id = ?',
    [channelInstanceId, '123'],
  );
  const [transactions] = await pool!.query<RowDataPacket[]>(
    'SELECT shopify_transaction_id, amount, balance_after, reference_type, reference_id FROM gift_card_transactions ORDER BY id',
  );
  return { cards, transactions };
}

async function assertLease(connection: PoolConnection) {
  const [jobs] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM ims_sales_channel_jobs WHERE business_id = ? AND channel_instance_id = ?
      AND operation_key = 'gift-cards' AND status = 'processing' AND lease_token = ?
      AND lease_expires_at > UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE`,
    [businessId, channelInstanceId, leaseToken],
  );
  if (!jobs.length) throw new Error('Gift recovery final lease fence was lost.');
}

function providerCard(history = page([transaction('999', '30')])) {
  return {
    id: 'gid://shopify/GiftCard/123', lastCharacters: 'ABCD', initialValue: { amount: '100' },
    balance: { amount: String(history.snapshot.balance), currencyCode: 'AUD' },
    createdAt: history.snapshot.created_at, updatedAt: history.snapshot.updated_at,
    expiresOn: null, deactivatedAt: null, enabled: true, customer: null, order: null, lineItem: null,
    transactions: {
      nodes: history.transactions, pageInfo: { hasNextPage: history.hasNextPage, endCursor: history.endCursor },
    },
    tip: { nodes: [{ id: history.latestTransactionId }] },
  };
}

describe.skipIf(!process.env.ONLINE_SYNC_TEST_PORT)('real MySQL gift-card recovery ledger (explicit loopback test server only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error('Explicit local MySQL test port required.');
    vi.stubEnv('IMS_MYSQL_HOST', '127.0.0.1');
    vi.stubEnv('MYSQL_HOST', '127.0.0.1');
    vi.stubEnv('MYSQL_PORT', String(port));
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_PASSWORD', password);
    vi.stubEnv('IMS_MYSQL_DATABASE', '');
    mocks.mainQuery.mockImplementation(async (sql: string) => {
      if (!sql.includes('FROM businesses')) throw new Error('Unexpected main metadata read.');
      return [{ business_id: businessId, ims_db_name: schema }];
    });
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      await server.query(`CREATE DATABASE \`${schema}\``);
      created = true;
    } finally { await server.end(); }
    pool = getIMSPool(schema);
    const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
    const statements = parseSchemaStatements(canonical).filter(statement =>
      /^\s*CREATE TABLE IF NOT EXISTS (gift_cards|gift_card_transactions|ims_sales_channel_jobs)\s*\(/.test(statement));
    expect(statements).toHaveLength(3);
    for (const statement of statements) await pool.query(statement);
    const connections = await Promise.all(Array.from({ length: 5 }, () => pool!.getConnection()));
    try { await Promise.all(connections.map(connection => connection.query("SET time_zone = '+11:00'"))); }
    finally { connections.forEach(connection => connection.release()); }
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.context.mockResolvedValue({
      credentials: { shopDomain: 'gift-recovery.test.myshopify.com', token: 'mock-test-token' },
    });
    mocks.fetch.mockImplementation(async () => { throw new Error('Unexpected provider call.'); });
    await pool!.query('DROP TRIGGER IF EXISTS gift_recovery_expire_final_fence');
    await pool!.query('DELETE FROM gift_card_transactions');
    await pool!.query('DELETE FROM gift_cards');
    await pool!.query('DELETE FROM ims_sales_channel_jobs');
    await pool!.execute(
      `INSERT INTO gift_cards
        (channel_instance_id, shopify_gc_id, code, initial_balance, balance, currency, status,
         shopify_observed_balance, shopify_updated_at, reconciliation_state)
       VALUES (?, 123, 'SHOPIFY:ABCD', 100, 100, 'AUD', 'active', 100, '2026-10-16 01:00:00', 'matched')`,
      [channelInstanceId],
    );
    await pool!.execute(
      `INSERT INTO ims_sales_channel_jobs
        (business_id, channel_instance_id, provider, operation, operation_key, status, lease_token, lease_expires_at)
       VALUES (?, ?, 'shopify', 'shopify_effects', 'gift-cards', 'processing', ?, TIMESTAMPADD(MINUTE, 5, UTC_TIMESTAMP(3)))`,
      [businessId, channelInstanceId, leaseToken],
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    invalidateImsDbCache(businessId);
    if (pool) {
      await pool.end();
      globalThis.__imsPools?.delete(schema);
      globalThis.__imsPoolLastUsed?.delete(schema);
    }
    if (created) {
      const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
      try {
        if (!/^gift_recovery_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema cleanup target.');
        await server.query(`DROP DATABASE \`${schema}\``);
      } finally { await server.end(); }
    }
    vi.unstubAllEnvs();
  });

  it('routes real SQL through the tenant callback and replays lost page/final checkpoints without duplicate balances or ledger', async () => {
    await runImsForBusiness(businessId, async () => {
      expect(getIMSPool()).toBe(pool);
      const firstInput = { ...identity, page: page([transaction('999', '20')], true), beforeCommit: assertLease };
      const first = await reconcileShopifyGiftCardHistoryPage(firstInput);
      const replay = await reconcileShopifyGiftCardHistoryPage(firstInput);
      expect(replay).toEqual(first);
      expect((await state()).transactions).toHaveLength(1);
      expect(Number((await state()).cards[0].balance)).toBe(100);
      if (first.status !== 'pending') throw new Error('Expected history checkpoint.');
      const continuation = parseShopifyGiftCardRecoveryContinuation({
        status: 'enabled', pageInfo: null, pageLoaded: true, pendingCardIds: ['123'],
        nextPageInfo: null, reviewRequired: 0, currentCard: first.checkpoint,
      });
      expect(continuation.currentCard?.baselineVersion).toBe('2026-10-16 01:00:00');
      const finalInput = {
        ...identity, checkpoint: continuation.currentCard, page: page([transaction('998', '10')]), beforeCommit: assertLease,
      };
      expect(await reconcileShopifyGiftCardHistoryPage(finalInput)).toEqual({ status: 'completed', checkpoint: null });
      expect(await reconcileShopifyGiftCardHistoryPage(finalInput)).toEqual({ status: 'completed', checkpoint: null });
      const saved = await state();
      expect(saved.transactions).toHaveLength(2);
      expect(saved.transactions.map(tx => Number(tx.amount))).toEqual([-20, -10]);
      expect(saved.transactions.map(tx => Number(tx.balance_after))).toEqual([70, 90]);
      expect(Number(saved.cards[0].balance)).toBe(70);
      expect(saved.cards[0].reconciliation_state).toBe('matched');
      expect(mocks.fetch).not.toHaveBeenCalled();
    });
  });

  it('completes a nonempty storefront only after actual bounded history imports', async () => {
    const guard = vi.fn(assertLease);
    const reply = (data: unknown) => mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data })));
    reply({ giftCards: { nodes: [{ id: 'gid://shopify/GiftCard/123', updatedAt: '2026-10-17T01:00:00Z' }],
      pageInfo: { hasNextPage: false, endCursor: null } } });
    reply({ giftCard: providerCard() });
    reply({ giftCards: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    await runImsForBusiness(businessId, async () => {
      const discovered = await recoverShopifyGiftCardEffects({ businessId, channelInstanceId, beforeCommit: guard, window });
      expect(discovered.status).toBe('pending');
      const reconciled = await recoverShopifyGiftCardEffects({
        businessId, channelInstanceId, continuation: discovered.continuation, beforeCommit: guard, window,
      });
      expect(reconciled).toMatchObject({ status: 'pending', processed: 1, reviewRequired: 0 });
      expect(await recoverShopifyGiftCardEffects({
        businessId, channelInstanceId, continuation: reconciled.continuation, beforeCommit: guard, window,
      })).toEqual({ status: 'completed', continuation: null, processed: 0, reviewRequired: 0 });
      const saved = await state();
      expect(saved.transactions).toHaveLength(1);
      expect(Number(saved.cards[0].balance)).toBe(70);
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      expect(guard).toHaveBeenCalledTimes(2);
    });
  });

  it.each(['version', 'balance', 'tip'] as const)('cannot finalize stale %s proof', async changed => {
    await runImsForBusiness(businessId, async () => {
      const first = await reconcileShopifyGiftCardHistoryPage({
        ...identity, page: page([transaction('999', '20')], true), beforeCommit: assertLease,
      });
      if (first.status !== 'pending') throw new Error('Expected history checkpoint.');
      const next = page([transaction('998', '10')]);
      if (changed === 'version') next.snapshot.updated_at = '2026-10-17T02:00:00Z';
      if (changed === 'balance') next.snapshot.balance = '80.00';
      if (changed === 'tip') next.latestTransactionId = 'gid://shopify/GiftCardCreditTransaction/1000';
      expect(await reconcileShopifyGiftCardHistoryPage({ ...identity, checkpoint: first.checkpoint, page: next }))
        .toEqual({ status: 'restart', checkpoint: null });
      const saved = await state();
      expect(saved.transactions).toHaveLength(1);
      expect(Number(saved.cards[0].balance)).toBe(100);
      expect(Number(saved.cards[0].shopify_observed_balance)).toBe(100);
    });
  });

  it('rolls back imported ledger and local correction when the final SQL lease fence changes', async () => {
    await pool!.query(`CREATE TRIGGER gift_recovery_expire_final_fence BEFORE UPDATE ON gift_cards
      FOR EACH ROW BEGIN
        IF NEW.balance <> OLD.balance THEN
          UPDATE ims_sales_channel_jobs SET lease_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3))
            WHERE operation_key = 'gift-cards';
        END IF;
      END`);
    await runImsForBusiness(businessId, async () => {
      await expect(reconcileShopifyGiftCardHistoryPage({
        ...identity, page: page([transaction('999', '30')]), beforeCommit: assertLease,
      })).rejects.toThrow('final lease fence');
    });

    const saved = await state();
    expect(saved.transactions).toHaveLength(0);
    expect(Number(saved.cards[0].balance)).toBe(100);
    expect(Number(saved.cards[0].shopify_observed_balance)).toBe(100);
    expect(saved.cards[0].reconciliation_state).toBe('matched');
  });

  it('rejects already-expired ownership before making any ledger or card changes', async () => {
    await pool!.execute(
      `UPDATE ims_sales_channel_jobs SET lease_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3))
        WHERE business_id = ? AND channel_instance_id = ?`,
      [businessId, channelInstanceId],
    );
    await runImsForBusiness(businessId, async () => {
      await expect(reconcileShopifyGiftCardHistoryPage({
        ...identity, page: page([transaction('999', '30')]),
      })).rejects.toThrow('lease fence');
    });
    const saved = await state();
    expect(saved.transactions).toHaveLength(0);
    expect(Number(saved.cards[0].balance)).toBe(100);
    expect(saved.cards[0].reconciliation_state).toBe('matched');
  });

  it('rolls back the final correction when a last-moment provider/main-source check changes', async () => {
    let observedUncommittedBalance: number | null = null;
    let guardCalls = 0;
    const guard: ShopifyGiftCardRecoveryCommitGuard = async (connection, source) => {
      await assertLease(connection);
      guardCalls++;
      if (guardCalls === 1) return;
      const [cards] = await connection.execute<RowDataPacket[]>(
        'SELECT balance FROM gift_cards WHERE channel_instance_id = ? AND shopify_gc_id = 123', [channelInstanceId],
      );
      observedUncommittedBalance = Number(cards[0].balance);
      const latestProviderVersion = '2026-10-17T02:00:00Z';
      if (source.sourceVersion !== latestProviderVersion) throw new Error('Gift recovery final source changed.');
    };
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { giftCard: providerCard() } })));
    await runImsForBusiness(businessId, async () => {
      expect(await recoverShopifyGiftCardEffects({
        businessId, channelInstanceId, beforeCommit: guard, window,
        continuation: {
          status: 'enabled', pageInfo: null, pageLoaded: true, pendingCardIds: ['123'], nextPageInfo: null,
        },
      })).toMatchObject({ status: 'retry', reason: 'gift_card_page_failed' });
    });
    expect(observedUncommittedBalance).toBe(70);
    const saved = await state();
    expect(saved.transactions).toHaveLength(0);
    expect(Number(saved.cards[0].balance)).toBe(100);
    expect(Number(saved.cards[0].shopify_observed_balance)).toBe(100);
  });
  it('leaves an unchanged historical card and its unknown-currency transactions entirely untouched', async () => {
    const before = await state();
    const history = page([{ ...transaction('999', '30'), amount: { amount: '30', currencyCode: 'XXX' } }]);
    const old = providerCard({ ...history, snapshot: { ...history.snapshot, updated_at: '2026-04-14T07:56:06Z' } });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { giftCard: old } })));
    const guard = vi.fn(assertLease);
    await runImsForBusiness(businessId, async () => {
      expect(await recoverShopifyGiftCardEffects({
        businessId, channelInstanceId, beforeCommit: guard, window,
        continuation: { status: 'enabled', pageInfo: null, pageLoaded: true, pendingCardIds: ['123'], nextPageInfo: null },
      })).toMatchObject({ status: 'pending', processed: 1, reviewRequired: 0 });
    });
    expect(guard).not.toHaveBeenCalled();
    expect(await state()).toEqual(before);
  });
});
