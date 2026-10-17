import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSchemaStatements } from '@/lib/ims/provisionBusiness';
import type { OnlineSyncSqlValue } from '../onlineSyncJobs';
import { ONLINE_SYNC_LIMITS } from '../onlineSyncPolicy';
import type { ShopifyGiftCardRecoveryCommitGuard } from '../shopifyGiftCardRecoveryHistory';
import { shopifyOrderSnapshot } from '../shopifyOrderSnapshot';

const mocks = vi.hoisted(() => ({
  main: vi.fn(), query: vi.fn(), execute: vi.fn(), pool: vi.fn(), instances: vi.fn(),
  page: vi.fn(), detail: vi.fn(), history: vi.fn(), apply: vi.fn(),
  report: vi.fn(), cron: vi.fn(), gift: vi.fn(), accounting: vi.fn(),
  context: vi.fn(), refundEffects: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.main }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.query, imsExecute: mocks.execute, getIMSPool: mocks.pool,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({
  runImsForBusiness: async (_business: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/ims/businessOperations', () => ({
  getOnlineChannelCapabilities: async () => ({ shopifyEnabled: true, nativeShopEnabled: true }),
  isXeroAccountingEnabled: async () => true,
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'UTC' }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/cron/settings', () => ({ checkCronJobEnabled: mocks.cron }));
vi.mock('../channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness: mocks.instances },
}));
vi.mock('../shopifyOperationContext', () => ({
  getShopifyOperationContext: mocks.context,
}));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    getOrderReconciliationPage = mocks.page;
    getOrderForReconciliation = mocks.detail;
    verifyOrderReconciliationHistoryAccess = mocks.history;
  },
}));
vi.mock('../shopifyOrderRecovery', async () => {
  class OnlineSyncSliceYield extends Error {}
  return { applyShopifyRecoverySnapshot: mocks.apply, OnlineSyncSliceYield };
});
vi.mock('../shopifyOrderRecoveryEffects', () => ({
  recoverShopifyPaidOrderEffects: vi.fn(), recoverShopifyRefundDownstreamEffects: mocks.refundEffects,
}));
vi.mock('../shopifyGiftCardRecoveryEffects', () => ({ recoverShopifyGiftCardEffects: mocks.gift }));
vi.mock('@/lib/xero/onlineDailyAccountingRecovery', () => ({ runOnlineDailyAccountingRecovery: mocks.accounting }));

import { runOnlineRecoveryDispatch } from '../onlineRecoveryWorker';

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `online_worker_test_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
const channel = {
  channelInstanceId: 'store', provider: 'shopify', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready',
  settings: { shopify: { orders: { enabled: true, syncFrom: '2026-01-01', locationId: 7 } } },
};
async function rows(sql: string, params: (string | number)[] = []) {
  return (await pool.query<RowDataPacket[]>(sql, params))[0];
}
async function job() {
  return (await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key = 'reconcile'"))[0];
}
async function state() {
  return (await rows('SELECT * FROM ims_shopify_reconciliation'))[0];
}
function decoded(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? JSON.parse(value) : value as Record<string, unknown>;
}

describe.skipIf(!port)('integrated recovery worker persistence on real MySQL (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit loopback test port is required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`CREATE DATABASE \`${schema}\``); } finally { await server.end(); }
    pool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: schema, connectionLimit: 6,
      timezone: 'Z', dateStrings: true,
    });
    const connection = await pool.getConnection();
    try {
      for (const sql of parseSchemaStatements(await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8'))) {
        await connection.query(sql);
      }
    } finally { connection.release(); }
    const connections = await Promise.all(Array.from({ length: 6 }, () => pool.getConnection()));
    try { await Promise.all(connections.map(conn => conn.query("SET time_zone = '+11:00'"))); }
    finally { connections.forEach(conn => conn.release()); }
  }, 60_000);

  beforeEach(async () => {
    vi.resetAllMocks();
    await pool.query('DROP TRIGGER IF EXISTS test_reject_coverage');
    for (const table of ['ims_credit_notes', 'ims_sales_orders', 'ims_locations',
      'ims_sales_channel_jobs', 'ims_shopify_reconciliation', 'ims_online_sync_control',
      'ims_online_day_changes', 'ims_shopify_order_recovery']) await pool.query(`DELETE FROM ${table}`);
    await pool.execute(
      "INSERT INTO ims_online_sync_control(business_id,rollout_state,paused) VALUES ('alpha','validation',0)",
    );
    mocks.main.mockImplementation(async (sql: string) => sql.includes('COUNT(*)')
      ? [{ total: 1 }] : [{ business_id: 'alpha' }]);
    mocks.pool.mockReturnValue(pool);
    mocks.query.mockImplementation(async (sql: string, params: OnlineSyncSqlValue[] = []) =>
      (await pool.execute<RowDataPacket[]>(sql, params))[0]);
    mocks.execute.mockImplementation(async (sql: string, params: OnlineSyncSqlValue[] = []) =>
      (await pool.execute<ResultSetHeader>(sql, params))[0]);
    mocks.instances.mockResolvedValue([channel]);
    mocks.context.mockResolvedValue({
      instance: { settings: channel.settings },
      credentials: { shopDomain: 'test.myshopify.com', token: 'test-fixture' },
    });
    mocks.cron.mockResolvedValue(null);
    mocks.page.mockResolvedValue({ orders: [], nextPageInfo: null });
    mocks.detail.mockImplementation(async (id: string) => ({ id, updated_at: new Date().toISOString() }));
    mocks.apply.mockResolvedValue('applied');
    mocks.gift.mockResolvedValue({ status: 'completed', continuation: null, processed: 0, reviewRequired: 0 });
    mocks.accounting.mockResolvedValue({ status: 'completed' });
    mocks.refundEffects.mockResolvedValue({ status: 'completed' });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`DROP DATABASE \`${schema}\``); } finally { await server.end(); }
  });

  it.each(["rollout_state = 'legacy'", 'paused = 1'])('does no provider or domain work with %s', async setting => {
    await pool.query(`UPDATE ims_online_sync_control SET ${setting}`);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ jobs: 0, processed: 0 });
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('persists the frozen initial window before provider access, then requires separate update catchup', async () => {
    const started = Date.now();
    mocks.page.mockImplementation(async () => {
      expect(decoded((await job()).payload_json).window).toBeDefined();
      return { orders: [], nextPageInfo: null };
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0, jobs: 1 });
    const initialFrom = Date.parse(String((await state()).baseline_from).replace(' ', 'T') + 'Z');
    expect(initialFrom).toBeGreaterThanOrEqual(started - 7 * 86400_000);
    expect(initialFrom).toBeLessThanOrEqual(Date.now() - 7 * 86400_000);
    expect(Number((await state()).baseline_complete)).toBe(0);
    expect(decoded((await job()).payload_json).window).toMatchObject({ phase: 'catchup' });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0, jobs: 1 });
    expect(Number((await state()).baseline_complete)).toBe(1);
    expect((await state()).covered_through).not.toBeNull();
    expect((await job()).payload_json).toBeNull();
  });
  it('applies at most 25 discovered orders and saves the other 225 without fetching another page', async () => {
    mocks.page.mockResolvedValue({
      orders: Array.from({ length: 250 }, (_, i) => ({
        id: String(1000 + i), updatedAt: new Date().toISOString(),
      })), nextPageInfo: null,
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0, processed: 25 });
    expect(mocks.page).toHaveBeenCalledOnce();
    expect(mocks.apply).toHaveBeenCalledTimes(25);
    expect(decoded((await job()).payload_json).remaining).toHaveLength(225);
    expect(Number((await state()).baseline_complete)).toBe(0);
  });
  it('never exceeds 100 order applications across businesses in one invocation', async () => {
    const businesses = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    for (const business of businesses.slice(1)) {
      await pool.execute(
        "INSERT INTO ims_online_sync_control(business_id,rollout_state) VALUES (?,'validation')", [business],
      );
    }
    mocks.main.mockImplementation(async (sql: string, params: string[]) => sql.includes('COUNT(*)')
      ? [{ total: 5 }] : sql.includes('WHERE business_id = ?')
        ? [{ business_id: params[0] }] : businesses.map(business_id => ({ business_id })));
    mocks.instances.mockImplementation(async (business: string) => [{ ...channel, channelInstanceId: `${business}-store` }]);
    mocks.page.mockResolvedValue({
      orders: Array.from({ length: 250 }, (_, i) => ({ id: String(1000 + i), updatedAt: new Date().toISOString() })),
      nextPageInfo: null,
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ processed: 100, jobs: 4, businesses: 4 });
    expect(mocks.apply).toHaveBeenCalledTimes(100);
    expect((await rows("SELECT last_run_at FROM ims_online_sync_control WHERE business_id='epsilon'"))[0].last_run_at)
      .toBeNull();
  });
  it('drains multiple durable jobs without granting a fresh 25-order allowance to the same storefront', async () => {
    for (let i = 0; i < 20; i += 1) {
      await pool.execute(`INSERT INTO ims_sales_channel_jobs
        (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
        VALUES ('alpha','store','shopify','shopify_order_apply',?,?,UTC_TIMESTAMP(3))`,
      [`event:${i}`, JSON.stringify({ kind: 'order_snapshot', orderId: String(2000 + i) })]);
    }
    mocks.page.mockResolvedValue({
      orders: Array.from({ length: 250 }, (_, i) => ({ id: String(1000 + i), updatedAt: new Date().toISOString() })),
      nextPageInfo: null,
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ processed: 25, jobs: 21, failed: 0 });
    expect(mocks.apply).toHaveBeenCalledTimes(25);
    expect(mocks.page).toHaveBeenCalledOnce();
    expect(decoded((await job()).payload_json).remaining).toHaveLength(245);
  });
  it('does not let older unready accounting jobs starve the initial Shopify baseline', async () => {
    for (const date of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      await pool.execute(`INSERT INTO ims_sales_channel_jobs
        (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
        VALUES ('alpha','store','shopify','online_daily_accounting',?,?,UTC_TIMESTAMP(3))`,
      [date, JSON.stringify({ kind: 'daily_accounting', date })]);
    }
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ jobs: 1, failed: 0 });
    expect(mocks.accounting).not.toHaveBeenCalled();
    expect(mocks.page).toHaveBeenCalledOnce();
  });
  it('never selects saved accounting jobs before the configured date even after coverage completes', async () => {
    mocks.instances.mockResolvedValue([{ ...channel, settings: { shopify: {
      ...channel.settings.shopify, xero: { dailyAutoSyncEnabled: true, dailyAccountingFrom: '2026-01-02' },
    } } }]);
    await runOnlineRecoveryDispatch();
    await runOnlineRecoveryDispatch();
    expect(Number((await state()).baseline_complete)).toBe(1);
    for (const date of ['2026-01-01', '2026-01-02']) {
      await pool.execute(`INSERT INTO ims_sales_channel_jobs
        (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
        VALUES ('alpha','store','shopify','online_daily_accounting',?,?,UTC_TIMESTAMP(3))`,
      [date, JSON.stringify({ kind: 'daily_accounting', date })]);
    }
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    expect(mocks.accounting).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-01-02' }));
    expect(mocks.accounting).not.toHaveBeenCalledWith(expect.objectContaining({ date: '2026-01-01' }));
    expect((await rows("SELECT status FROM ims_sales_channel_jobs WHERE operation_key='2026-01-01'"))[0].status).toBe('pending');
  });
  it.each([{ cnDate: '2026-01-01', calls: 0 }, { cnDate: '2026-01-02', calls: 1 }])(
    'only recovers credit-note posting within the accounting date: %j', async ({ cnDate, calls }) => {
    const settings = { shopify: {
      ...channel.settings.shopify, xero: { dailyAccountingFrom: '2026-01-02' },
    } };
    mocks.instances.mockResolvedValue([{ ...channel, settings }]);
    mocks.context.mockResolvedValue({
      instance: { settings }, credentials: { shopDomain: 'test.myshopify.com', token: 'test-fixture' },
    });
    const order = {
      id: '123', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-03T00:00:00Z',
      financial_status: 'paid', currency: 'AUD', cancelled_at: null, fulfillment_status: null,
      subtotal_price: '20', total_tax: '2', total_price: '22', total_discounts: '0',
      line_items: [{ id: '456', quantity: 2, price: '11' }], fulfillments: [], refunds: [{ id: '8001' }],
    };
    const snapshot = shopifyOrderSnapshot({ businessId: 'alpha', channelInstanceId: 'store', order });
    mocks.detail.mockResolvedValue(order);
    await pool.query("INSERT INTO ims_locations (id,business_id,name) VALUES (7,'alpha','Fixture')");
    await pool.query(`INSERT INTO ims_sales_orders
      (id,business_id,so_number,so_type,sales_channel,channel_instance_id,external_order_id,location_id,status,order_date)
      VALUES (44,'alpha','SO-44','online','shopify','store','123',7,'confirmed','2026-01-01')`);
    await pool.execute(`INSERT INTO ims_credit_notes
      (id,business_id,cn_number,so_id,location_id,status,source,channel_instance_id,external_refund_id,cn_date)
      VALUES (71,'alpha','CN-71',44,7,'complete','shopify','store','8001',?)`, [cnDate]);
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','shopify','shopify_order_apply','effects:123',?,UTC_TIMESTAMP(3))`, [JSON.stringify({
      kind: 'order_effects', orderId: '123', updatedAt: snapshot.updatedAt, hash: snapshot.hash, paid: false, refundIds: ['8001'],
    })]);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    expect(mocks.refundEffects).toHaveBeenCalledTimes(calls);
    expect((await rows("SELECT status FROM ims_sales_channel_jobs WHERE operation_key='effects:123'"))[0].status).toBe('complete');
    expect((await rows('SELECT status FROM ims_credit_notes WHERE id=71'))[0].status).toBe('complete');
  });
  it('caps one business at 25 jobs even when its two storefronts and global budget have spare capacity', async () => {
    mocks.instances.mockResolvedValue([channel, { ...channel, channelInstanceId: 'store-2' }]);
    for (let i = 0; i < 26; i += 1) {
      await pool.execute(`INSERT INTO ims_sales_channel_jobs
        (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
        VALUES ('alpha',?,'shopify','shopify_order_apply',?,?,UTC_TIMESTAMP(3))`,
      [i % 2 ? 'store-2' : 'store', `event:${i}`, JSON.stringify({ kind: 'order_snapshot', orderId: String(2000 + i) })]);
    }
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ jobs: 25, processed: 25, failed: 0 });
    expect((await rows("SELECT status FROM ims_sales_channel_jobs WHERE operation_key='event:25'"))[0].status).toBe('pending');
  });
  it('does not start an order application once the exact 45-second soft budget is reached', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    mocks.page.mockImplementation(async () => {
      clock.mockReturnValue(start + 45_000);
      return { orders: [{ id: '123', updatedAt: new Date().toISOString() }], nextPageInfo: null };
    });
    try {
      expect(await runOnlineRecoveryDispatch()).toMatchObject({ processed: 0, failed: 0 });
      expect(mocks.apply).not.toHaveBeenCalled();
      expect(decoded((await job()).payload_json).remaining).toHaveLength(1);
    } finally { vi.restoreAllMocks(); }
  });
  it('does not substitute an empty baseline when provider history access is missing', async () => {
    const { OnlineSyncValidationError } = await import('../onlineSyncPolicy');
    mocks.history.mockRejectedValue(new OnlineSyncValidationError('Shopify read_all_orders access is required.'));
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    expect((await job()).safe_error).toBe('history_unavailable');
    expect(Number((await state()).baseline_complete)).toBe(0);
    expect((await state()).covered_through).toBeNull();
  });
  it('cannot checkpoint or advance coverage after pause during provider access', async () => {
    mocks.page.mockImplementation(async () => {
      await pool.query('UPDATE ims_online_sync_control SET paused = 1');
      return { orders: [{ id: '123', updatedAt: new Date().toISOString() }], nextPageInfo: null };
    });
    await runOnlineRecoveryDispatch();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(Number((await state()).baseline_complete)).toBe(0);
    expect((await state()).covered_through).toBeNull();
    expect(decoded((await job()).payload_json).pageLoaded).toBe(false);
  });
  it('cannot checkpoint or advance coverage after losing the business lease', async () => {
    mocks.page.mockImplementation(async () => {
      await pool.query('UPDATE ims_online_sync_control SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND');
      return { orders: [], nextPageInfo: null };
    });
    await runOnlineRecoveryDispatch();
    expect((await state()).covered_through).toBeNull();
    expect(decoded((await job()).payload_json).pageLoaded).toBe(false);
  });
  it('rolls back job completion and coverage together if the coverage write fails', async () => {
    await runOnlineRecoveryDispatch();
    await pool.query(`CREATE TRIGGER test_reject_coverage BEFORE UPDATE ON ims_shopify_reconciliation
      FOR EACH ROW BEGIN IF NEW.baseline_complete = 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test coverage persistence failure'; END IF; END`);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    expect(Number((await state()).baseline_complete)).toBe(0);
    expect((await state()).covered_through).toBeNull();
    expect((await job()).status).toBe('failed');
    expect(decoded((await job()).payload_json).window).toMatchObject({ phase: 'catchup' });
    expect(mocks.report).toHaveBeenCalled();
  });
  it('persists provider Retry-After beyond the ordinary backoff ceiling without raw payloads', async () => {
    mocks.page.mockRejectedValue({
      statusCode: 429, response: { headers: { 'retry-after': '7200' }, body: { customer: 'private' } },
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    expect((await job()).safe_error).toBe('provider_rate_limit');
    expect(Number((await rows("SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),available_at) AS seconds FROM ims_sales_channel_jobs"))[0].seconds))
      .toBeGreaterThan(7100);
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('private');
  });
  it('records malformed work as failed instead of stranding it on a processing lease', async () => {
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','shopify','shopify_order_apply','event:poison','{}',UTC_TIMESTAMP(3))`);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    const [poison] = await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key='event:poison'");
    expect(poison.status).toBe('failed');
    expect(poison.safe_error).toBe('source_conflict');
    expect(poison.lease_token).toBeNull();
  });
  it('persists terminal gift review and never restarts discovery automatically', async () => {
    mocks.instances.mockResolvedValue([{
      ...channel, settings: { shopify: { orders: { enabled: false }, giftCards: { mode: 'combined' } } },
    }]);
    mocks.gift.mockResolvedValue({
      status: 'blocked', continuation: null, processed: 25, reviewRequired: 1, reason: 'gift_card_review_required',
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    const [gift] = await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key='gift_cards'");
    expect(decoded(gift.payload_json)).toMatchObject({
      kind: 'gift_cards', continuation: null, blockedReason: 'gift_card_review_required',
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ jobs: 0 });
    expect(mocks.gift).toHaveBeenCalledOnce();
  });
  it('persists every financial/history checkpoint field before yielding a gift-card page', async () => {
    mocks.instances.mockResolvedValue([{
      ...channel, settings: { shopify: { orders: { enabled: false }, giftCards: { mode: 'combined' } } },
    }]);
    const continuation = {
      status: 'enabled', pageInfo: null, nextPageInfo: null, pageLoaded: true, pendingCardIds: ['123'],
      reviewRequired: 0,
      currentCard: {
        cardId: '123', transactionCursor: 'cursor123', sourceVersion: '2026-10-17T01:00:00Z',
        latestTransactionId: 'gid://shopify/GiftCardDebitTransaction/999',
        providerBalanceCents: 1000, runningBalanceCents: 900, unseenAmountCents: 100,
        baselineLocalBalanceCents: 1000, baselineObservedBalanceCents: 1000,
        baselineVersion: '2026-10-16 01:00:00',
      },
    };
    mocks.gift.mockResolvedValue({ status: 'pending', continuation, processed: 1, reviewRequired: 0 });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    const [gift] = await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key='gift_cards'");
    expect(decoded(gift.payload_json).continuation).toEqual(continuation);
    await runOnlineRecoveryDispatch();
    expect(mocks.gift.mock.calls[1][0].continuation).toEqual(continuation);
    expect(mocks.gift.mock.calls[1][0].window).toEqual(mocks.gift.mock.calls[0][0].window);
  });
  it('persists completed gift coverage and resumes the full outage gap with overlap, not a new seven-day scan', async () => {
    const settings = { shopify: { orders: { enabled: false }, giftCards: { mode: 'combined' } } };
    mocks.instances.mockResolvedValue([{ ...channel, settings }]);
    mocks.context.mockResolvedValue({ instance: { settings }, credentials: { shopDomain: 'test.myshopify.com', token: 'fixture' } });
    const coveredThrough = new Date(Date.now() - 30 * 86400_000).toISOString();
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','shopify','shopify_order_apply','gift_cards',?,UTC_TIMESTAMP(3))`,
      [JSON.stringify({ kind: 'gift_cards', continuation: null, coveredThrough })]);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    const firstWindow = mocks.gift.mock.calls[0][0].window;
    expect(Date.parse(firstWindow.from)).toBe(Date.parse(coveredThrough) - ONLINE_SYNC_LIMITS.overlapMs);
    const [gift] = await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key='gift_cards'");
    expect(decoded(gift.payload_json)).toEqual({ kind: 'gift_cards', continuation: null, coveredThrough: firstWindow.to });
    await pool.execute("UPDATE ims_sales_channel_jobs SET available_at=UTC_TIMESTAMP(3) WHERE operation_key='gift_cards'");
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    expect(Date.parse(mocks.gift.mock.calls[1][0].window.from))
      .toBe(Date.parse(firstWindow.to) - ONLINE_SYNC_LIMITS.overlapMs);
  });
  it('holds an old unscoped gift-card cursor rather than silently continuing historical scanning', async () => {
    const settings = { shopify: { orders: { enabled: false }, giftCards: { mode: 'combined' } } };
    mocks.instances.mockResolvedValue([{ ...channel, settings }]);
    const continuation = {
      status: 'enabled', pageInfo: null, pageLoaded: true, pendingCardIds: ['123'],
      nextPageInfo: null, currentCard: null, reviewRequired: 0,
    };
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','shopify','shopify_order_apply','gift_cards',?,UTC_TIMESTAMP(3))`,
      [JSON.stringify({ kind: 'gift_cards', continuation })]);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    const [gift] = await rows("SELECT * FROM ims_sales_channel_jobs WHERE operation_key='gift_cards'");
    expect(decoded(gift.payload_json)).toEqual({
      kind: 'gift_cards', continuation, blockedReason: 'gift_card_rebaseline_required',
    });
    expect(mocks.gift).not.toHaveBeenCalled();
  });
  it('binds the gift commit guard to the exact live job and rolls back work after final-fence loss', async () => {
    mocks.instances.mockResolvedValue([{
      ...channel, settings: { shopify: { orders: { enabled: false }, giftCards: { mode: 'combined' } } },
    }]);
    mocks.gift.mockImplementation(async ({ beforeCommit }: { beforeCommit: ShopifyGiftCardRecoveryCommitGuard }) => {
      const connection = await pool.getConnection();
      const source = { cardId: '123', sourceVersion: '2026-10-17T01:00:00Z', providerBalanceCents: 1000, latestTransactionId: null };
      try {
        await connection.beginTransaction();
        await beforeCommit(connection, source);
        await connection.query(`INSERT INTO ims_online_day_changes
          (business_id,channel_instance_id,business_date,generation) VALUES ('alpha','store','2026-10-17',UUID())`);
        await connection.query('UPDATE ims_sales_channel_jobs SET lease_expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND');
        await beforeCommit(connection, source);
        await connection.commit();
        throw new Error('An expired gift fence must not commit.');
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0 });
    expect((await rows('SELECT COUNT(*) AS total FROM ims_online_day_changes'))[0].total).toBe(0);
    expect(mocks.gift).toHaveBeenCalledOnce();
  });
  it('honors the separate accounting Cron pause while still doing order recovery', async () => {
    mocks.cron.mockResolvedValue(new Response(null, { status: 200 }));
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','shopify','online_daily_accounting','2026-01-01',
        '{"kind":"daily_accounting","date":"2026-01-01"}',UTC_TIMESTAMP(3))`);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0, jobs: 1 });
    expect(mocks.accounting).not.toHaveBeenCalled();
    expect(mocks.page).toHaveBeenCalledOnce();
  });
  it('honors durable accounting retry delay rather than replacing it with generic backoff', async () => {
    mocks.instances.mockResolvedValue([{ ...channel, provider: 'native_shop' }]);
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','native_shop','online_daily_accounting','2026-01-01',
        '{"kind":"daily_accounting","date":"2026-01-01"}',UTC_TIMESTAMP(3))`);
    mocks.accounting.mockResolvedValue({ status: 'retry', reason: 'rate_limit', retryAfterSeconds: 7200 });
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 1 });
    const [retry] = await rows('SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),available_at) AS seconds FROM ims_sales_channel_jobs');
    expect(Number(retry.seconds)).toBeGreaterThan(7100);
  });
  it('allows explicitly authorised manual accounting when only scheduled accounting is paused', async () => {
    mocks.cron.mockResolvedValue(new Response(null, { status: 200 }));
    mocks.instances.mockResolvedValue([{ ...channel, provider: 'native_shop' }]);
    await pool.execute(`INSERT INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
      VALUES ('alpha','store','native_shop','online_daily_accounting','2026-01-01',
        '{"kind":"daily_accounting","date":"2026-01-01","manual":true}',UTC_TIMESTAMP(3))`);
    expect(await runOnlineRecoveryDispatch()).toMatchObject({ failed: 0, jobs: 1 });
    expect(mocks.accounting).toHaveBeenCalledWith({
      businessId: 'alpha', channelInstanceId: 'store', date: '2026-01-01', manual: true,
    });
    expect((await rows("SELECT status FROM ims_sales_channel_jobs WHERE operation_key='2026-01-01'"))[0].status)
      .toBe('complete');
  });
});
