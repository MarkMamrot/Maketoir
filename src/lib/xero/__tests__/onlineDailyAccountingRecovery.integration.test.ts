import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineSyncTableDdl } from '../../../../scripts/online-sync-schema.mjs';
import { OnlineSyncLeaseLostError } from '@/lib/channels/onlineSyncPolicy';
import type { OnlineSyncSqlValue } from '@/lib/channels/onlineSyncJobs';
import { DEFAULT_XERO_DOCUMENT_POLICY } from '../documentPolicies';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), imsQuery: vi.fn(), imsExecute: vi.fn(), getPool: vi.fn(), getIMSPool: vi.fn(),
  runIms: vi.fn(), provider: vi.fn(), policy: vi.fn(), report: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute, getPool: mocks.getPool }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute, getIMSPool: mocks.getIMSPool }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runIms }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'Australia/Sydney' }));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertXeroAccountingEnabled: async () => undefined,
  isXeroAccountingDisabledError: () => false,
}));
vi.mock('@/lib/xero/documentPolicyRepository', () => ({ getXeroDocumentPolicy: mocks.policy }));
vi.mock('@/services/XeroService', () => ({ xeroApiFetch: mocks.provider, getValidAccessToken: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/xero/reportXeroFailure', () => ({ getXeroConfigurationNotice: () => false, reportXeroFailure: mocks.report }));

import { getOnlineDailyAccountingReadiness, runOnlineDailyAccountingRecovery } from '../onlineDailyAccountingRecovery';

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const suffix = randomUUID().replaceAll('-', '');
const schemas = { main: `online_account_main_${suffix}`, tenant: `online_account_tenant_${suffix}` };
const created: string[] = [];
const tenantContext = new AsyncLocalStorage<string>();
const input = { businessId: 'alpha', channelInstanceId: 'store', date: '2020-01-03' };
const stages = ['invoice', 'payment', 'fee', 'journal'] as const;
type Stage = typeof stages[number];
type SqlValues = OnlineSyncSqlValue[];
interface ProviderOptions { method?: string; idempotencyKey?: string; body?: Record<string, Record<string, unknown>[]> }
let main: Pool;
let tenant: Pool;
let crashAfter: Stage | null;
let rejectFinalization: boolean;
let pauseAtFinalization: boolean;
let tenantPauseBeforeCompletionLock: boolean;
let atCompletionSql: (() => Promise<void>) | null;
let failDirtyAck: boolean;
let newerGenerationDuringAck: string | null;
let ackAffectedRows: number[];
let providerHook: ((stage: Stage) => Promise<void>) | null;
let invoiceTotal: number;
let invoicePaid: number;

function isStageCommit(stage: Stage, sql: string, values: SqlValues): boolean {
  if (stage === 'invoice') return sql.includes('xero_invoice_number = VALUES(xero_invoice_number)');
  if (stage === 'payment') return sql.includes('UPDATE xero_online_order_payments') && sql.includes("SET status = 'completed'");
  if (stage === 'fee') return sql.includes('UPDATE xero_online_order_fees') && sql.includes("SET status = 'completed'");
  return sql.includes('INSERT INTO xero_sync_log') && values[1] === 'gift_card_liability' && values[4] === 'success';
}
async function expireLease(): Promise<void> {
  await main.execute(
    'UPDATE xero_online_batches SET sync_lease_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)) WHERE business_id = ?',
    [input.businessId],
  );
}
function assertTenant(): void {
  if (tenantContext.getStore() !== input.businessId) throw new Error('Integration tenant SQL requires the exact callback context.');
}
async function rows<T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, values: SqlValues = []): Promise<T[]> {
  const [result] = await pool.execute<T[]>(sql, values);
  return result;
}
async function currentBatch(): Promise<RowDataPacket> {
  const result = await rows(main, 'SELECT * FROM xero_online_batches WHERE business_id = ?', [input.businessId]);
  if (!result[0]) throw new Error('Expected an isolated canonical accounting batch.');
  return result[0];
}
function postCounts(): Record<Stage, number> {
  return Object.fromEntries(stages.map(stage => [stage, mocks.provider.mock.calls.filter(([, requestPath, options]) =>
    (options as ProviderOptions | undefined)?.method === 'POST'
      && requestPath === ({ invoice: '/Invoices', payment: '/Payments', fee: '/BankTransactions', journal: '/ManualJournals' }[stage]),
  ).length])) as Record<Stage, number>;
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function dirtyDay(generation: string, changeFinancialFacts = false): Promise<void> {
  const connection = await tenant.getConnection();
  try {
    await connection.beginTransaction();
    if (changeFinancialFacts) await connection.execute(
      'UPDATE ims_sales_orders SET total_amount = 121, tax_amount = 11 WHERE business_id = ? AND channel_instance_id = ?',
      [input.businessId, input.channelInstanceId],
    );
    await connection.execute(
      `INSERT INTO ims_online_day_changes (business_id, channel_instance_id, business_date, generation)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE generation = VALUES(generation)`,
      [input.businessId, input.channelInstanceId, input.date, generation],
    );
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

describe.skipIf(!port)('daily accounting recovery on real isolated MySQL (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('An explicit local test port is required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      for (const schema of Object.values(schemas)) {
        await server.query(`CREATE DATABASE \`${schema}\``);
        created.push(schema);
      }
    } finally { await server.end(); }
    const options = { host: '127.0.0.1', port, user: 'root', password, connectionLimit: 8, timezone: 'Z', dateStrings: true };
    main = mysql.createPool({ ...options, database: schemas.main });
    tenant = mysql.createPool({ ...options, database: schemas.tenant });
    for (const pool of [main, tenant]) {
      const connections = await Promise.all(Array.from({ length: 8 }, () => pool.getConnection()));
      try { await Promise.all(connections.map(connection => connection.query("SET time_zone = '+11:00'"))); }
      finally { connections.forEach(connection => connection.release()); }
    }
    const [mainDdl, xeroDdl, imsDdl] = await Promise.all([
      readFile(path.join(process.cwd(), 'scripts', 'marketoir-schema.sql'), 'utf8'),
      readFile(path.join(process.cwd(), 'scripts', 'setup-xero-tables.sql'), 'utf8'),
      readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8'),
    ]);
    for (const table of ['businesses', 'sales_channel_instances']) await main.query(onlineSyncTableDdl(mainDdl, table));
    // Runtime soft-delete migration extends the older canonical registry definition.
    await main.query('ALTER TABLE businesses ADD COLUMN deleted_at DATETIME NULL');
    for (const table of ['xero_account_mappings', 'xero_tracking_mappings', 'xero_sync_log',
      'xero_online_batches', 'xero_online_order_payments', 'xero_online_order_fees']) {
      await main.query(onlineSyncTableDdl(xeroDdl, table));
    }
    const connection = await tenant.getConnection();
    try {
      // Only selected canonical source tables are needed; unrelated contact/warehouse FK graphs are not under test.
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of ['ims_online_sync_control', 'ims_shopify_reconciliation', 'ims_shopify_order_recovery',
        'ims_online_day_changes', 'ims_sales_orders', 'ims_sales_order_payments']) {
        await connection.query(onlineSyncTableDdl(imsDdl, table));
      }
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      connection.release();
    }
    mocks.getPool.mockReturnValue(main);
    mocks.getIMSPool.mockReturnValue({ getConnection: async () => {
      assertTenant();
      if (tenantPauseBeforeCompletionLock) {
        tenantPauseBeforeCompletionLock = false;
        await tenant.execute('UPDATE ims_online_sync_control SET paused = 1 WHERE business_id = ?', [input.businessId]);
      }
      return tenant.getConnection();
    } });
    mocks.runIms.mockImplementation((businessId: string, callback: () => Promise<unknown>) =>
      tenantContext.run(businessId, callback));
    mocks.query.mockImplementation(async (sql: string, values: SqlValues = []) => {
      if (sql.includes('FROM xero_gateway_mappings')) return [{
        gateway_name: 'stripe', clearing_account_code: '091', fee_account_code: '400', fee_tax_type: 'INPUT',
        deduct_fee_enabled: 1, fixed_fee_amount: 0.3, percentage_fee_rate: 1,
      }];
      return rows(main, sql, values);
    });
    mocks.execute.mockImplementation(async (sql: string, values: SqlValues = []) => {
      if (sql.includes('SET sync_status = ?') && values[0] === 'completed') await atCompletionSql?.();
      if (rejectFinalization && sql.includes('SET sync_status = ?') && values[0] === 'completed') {
        rejectFinalization = false;
        await expireLease();
      }
      if (pauseAtFinalization && sql.includes('SET sync_status = ?') && values[0] === 'completed') {
        pauseAtFinalization = false;
        await main.execute('UPDATE businesses SET automation_paused = 1 WHERE business_id = ?', [input.businessId]);
      }
      const [result] = await main.execute<ResultSetHeader>(sql, values);
      if (crashAfter && isStageCommit(crashAfter, sql, values)) {
        crashAfter = null;
        await expireLease();
        throw new OnlineSyncLeaseLostError();
      }
      return result;
    });
    mocks.imsQuery.mockImplementation(async (sql: string, values: SqlValues = []) => {
      assertTenant();
      return rows(tenant, sql, values);
    });
    mocks.imsExecute.mockImplementation(async (sql: string, values: SqlValues = []) => {
      assertTenant();
      if (sql.includes('SET propagated_generation')) {
        if (failDirtyAck) { failDirtyAck = false; throw new Error('Injected crash between main evidence and tenant acknowledgement.'); }
        if (newerGenerationDuringAck) {
          const generation = newerGenerationDuringAck;
          newerGenerationDuringAck = null;
          await dirtyDay(generation, true);
        }
      }
      const [result] = await tenant.execute<ResultSetHeader>(sql, values);
      if (sql.includes('SET propagated_generation')) ackAffectedRows.push(result.affectedRows);
      return result;
    });
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    crashAfter = null; rejectFinalization = false; pauseAtFinalization = false; tenantPauseBeforeCompletionLock = false;
    atCompletionSql = null; failDirtyAck = false; newerGenerationDuringAck = null;
    ackAffectedRows = []; providerHook = null; invoiceTotal = 0; invoicePaid = 0;
    mocks.policy.mockResolvedValue({ ...DEFAULT_XERO_DOCUMENT_POLICY });
    mocks.report.mockResolvedValue(null);
    for (const table of ['xero_online_order_fees', 'xero_online_order_payments', 'xero_online_batches',
      'xero_sync_log', 'xero_account_mappings', 'xero_tracking_mappings', 'sales_channel_instances', 'businesses']) {
      await main.query(`DELETE FROM \`${table}\``);
    }
    const connection = await tenant.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of ['ims_sales_order_payments', 'ims_sales_orders', 'ims_online_day_changes',
        'ims_shopify_order_recovery', 'ims_shopify_reconciliation', 'ims_online_sync_control']) {
        await connection.query(`DELETE FROM \`${table}\``);
      }
      await connection.execute(
        `INSERT INTO ims_sales_orders
          (business_id, so_number, location_id, so_type, sales_channel, channel_instance_id, status, order_date,
           subtotal, tax_amount, total_amount, gift_card_amount, payment_gateway, shopify_order_id, shopify_order_name)
         VALUES (?, 'TEST-123', 1, 'online', 'shopify', ?, 'confirmed', ?, 100, 10, 110, 20, 'stripe', '123', '#123')`,
        [input.businessId, input.channelInstanceId, input.date],
      );
    } finally { await connection.query('SET FOREIGN_KEY_CHECKS = 1'); connection.release(); }
    await main.execute('INSERT INTO businesses (business_id, name) VALUES (?, ?)', [input.businessId, 'Isolated accounting test']);
    await main.execute(
      `INSERT INTO sales_channel_instances
        (channel_instance_id, business_id, provider, display_name, is_enabled, runtime_status, readiness_status, settings_json)
       VALUES (?, ?, 'shopify', 'Isolated storefront', 1, 'active', 'ready', ?)`,
      [input.channelInstanceId, input.businessId, JSON.stringify({
        shopify: { orders: { enabled: true, syncFrom: '2020-01-02', locationId: 1 }, xero: { dailyAutoSyncEnabled: true } },
      })],
    );
    await main.execute(
      `INSERT INTO xero_account_mappings (business_id, role_key, xero_account_code)
       VALUES (?, 'sales_revenue', '200'), (?, 'gift_card_liability', '800')`, [input.businessId, input.businessId],
    );
    await tenant.execute("INSERT INTO ims_online_sync_control (business_id, rollout_state) VALUES (?, 'cutover')", [input.businessId]);
    await tenant.execute(
      `INSERT INTO ims_shopify_reconciliation (business_id, channel_instance_id, baseline_from, baseline_complete, covered_through)
       VALUES (?, ?, '2020-01-01', 1, TIMESTAMPADD(DAY, 1, UTC_TIMESTAMP(3)))`, [input.businessId, input.channelInstanceId],
    );
    mocks.provider.mockImplementation(async (_businessId: string, requestPath: string, options: ProviderOptions = {}) => {
      if (!options.method || options.method === 'GET') {
        if (requestPath !== '/Invoices/invoice-test') throw new Error(`Unexpected read-only provider path ${requestPath}`);
        return { Invoices: [{ InvoiceID: 'invoice-test', Status: invoicePaid ? 'PAID' : 'AUTHORISED', Total: invoiceTotal, AmountPaid: invoicePaid }] };
      }
      const stagePaths: Record<string, Stage | undefined> = {
        '/Invoices': 'invoice', '/Payments': 'payment', '/BankTransactions': 'fee', '/ManualJournals': 'journal',
      };
      const stage = stagePaths[requestPath];
      if (!stage || options.method !== 'POST' || !/^[a-f0-9]{64}$/.test(options.idempotencyKey ?? '')) {
        throw new Error('Unexpected provider mutation or missing stable idempotency identity.');
      }
      if (stage === 'invoice') {
        const lines = options.body?.Invoices?.[0]?.LineItems as { UnitAmount: number; TaxAmount: number }[];
        invoiceTotal = lines.reduce((sum, line) => sum + line.UnitAmount + line.TaxAmount, 0);
      }
      if (stage === 'payment') invoicePaid += Number(options.body?.Payments?.[0]?.Amount);
      await providerHook?.(stage);
      if (stage === 'invoice') return { Invoices: [{ InvoiceID: 'invoice-test', InvoiceNumber: 'TEST-INV', Status: 'AUTHORISED', Total: invoiceTotal }] };
      if (stage === 'payment') return { Payments: [{ PaymentID: 'payment-test' }] };
      if (stage === 'fee') return { BankTransactions: [{ BankTransactionID: 'fee-test' }] };
      return { ManualJournals: [{ ManualJournalID: 'journal-test', Status: 'POSTED' }] };
    });
  });

  afterAll(async () => {
    if (main) await main.end();
    if (tenant) await tenant.end();
    if (!created.length) return;
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      for (const schema of created.reverse()) {
        if (!/^online_account_(main|tenant)_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe integration cleanup target.');
        await server.query(`DROP DATABASE \`${schema}\``);
      }
      const [remaining] = await server.execute<RowDataPacket[]>(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)', Object.values(schemas),
      );
      expect(remaining).toEqual([]);
      await server.ping();
    } finally { await server.end(); }
  });

  it('allows one concurrent owner and posts each real durable stage exactly once', async () => {
    const entered = deferred();
    const release = deferred();
    providerHook = async stage => { if (stage === 'invoice') { entered.resolve(); await release.promise; } };
    const first = runOnlineDailyAccountingRecovery(input);
    try {
      await entered.promise;
      const contenders = await Promise.all(Array.from({ length: 6 }, () => runOnlineDailyAccountingRecovery(input)));
      expect(contenders.every(result => result.status === 'retry' && result.reason === 'accounting_busy')).toBe(true);
      expect(postCounts()).toEqual({ invoice: 1, payment: 0, fee: 0, journal: 0 });
    } finally { release.resolve(); }
    expect(await first).toMatchObject({ status: 'completed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
    expect((await rows(main, 'SELECT * FROM xero_online_order_payments'))).toHaveLength(1);
    expect((await rows(main, 'SELECT * FROM xero_online_order_fees'))).toHaveLength(1);
    expect((await currentBatch()).sync_status).toBe('completed');
  });

  it.each(stages)('resumes a committed %s after a crash without replaying that stage', async stage => {
    crashAfter = stage;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'lease_lost' });
    expect((await currentBatch()).sync_status).not.toBe('completed');
    expect(postCounts()[stage]).toBe(1);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
    const batch = await currentBatch();
    const persisted = typeof batch.sync_stages_json === 'string' ? JSON.parse(batch.sync_stages_json) : batch.sync_stages_json;
    expect(persisted.invoice).toMatchObject({ state: 'completed', xeroId: 'invoice-test' });
    expect(persisted.payments.state).toBe('completed');
    expect(persisted.fees.state).toBe('completed');
    expect(persisted.gift_card_liability).toMatchObject({ state: 'completed', xeroId: 'journal-test' });
  });

  it('cannot finalize after its lease expires immediately before the completion CAS', async () => {
    rejectFinalization = true;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'lease_lost' });
    expect((await currentBatch()).sync_status).not.toBe('completed');
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('cannot finalize after a global business pause wins the actual completion SQL race', async () => {
    pauseAtFinalization = true;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'business_automation_paused' });
    expect((await currentBatch()).sync_status).not.toBe('completed');
    await main.execute('UPDATE businesses SET automation_paused = 0 WHERE business_id = ?', [input.businessId]);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('cannot finalize after a tenant pause commits immediately before the completion lock', async () => {
    tenantPauseBeforeCompletionLock = true;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'paused' });
    expect((await currentBatch()).sync_status).not.toBe('completed');
    await tenant.execute('UPDATE ims_online_sync_control SET paused = 0 WHERE business_id = ?', [input.businessId]);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('serializes a racing tenant pause after the final readiness check behind the completion CAS', async () => {
    const entered = deferred();
    const release = deferred();
    atCompletionSql = async () => { entered.resolve(); await release.promise; };
    const running = runOnlineDailyAccountingRecovery(input);
    let pauseCommitted = false;
    let pause: Promise<unknown> | undefined;
    try {
      await entered.promise;
      pause = tenant.execute('UPDATE ims_online_sync_control SET paused = 1 WHERE business_id = ?', [input.businessId])
        .then(() => { pauseCommitted = true; });
      await main.query('SELECT SLEEP(0.05)');
      expect(pauseCommitted).toBe(false);
      expect((await currentBatch()).sync_status).not.toBe('completed');
    } finally { release.resolve(); }
    expect(await running).toMatchObject({ status: 'completed' });
    await pause;
    expect(pauseCommitted).toBe(true);
    expect((await currentBatch()).sync_status).toBe('completed');
    expect((await rows(tenant, 'SELECT paused FROM ims_online_sync_control'))[0].paused).toBe(1);
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('cannot clear a successor lease or replay a provider-accepted invoice with an uncommitted local result', async () => {
    const successor = randomUUID();
    providerHook = async stage => {
      if (stage === 'invoice') await main.execute(
        `UPDATE xero_online_batches SET sync_lease_token = ?,
          sync_lease_expires_at = TIMESTAMPADD(SECOND, 180, UTC_TIMESTAMP(3)) WHERE business_id = ?`,
        [successor, input.businessId],
      );
    };
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'lease_lost' });
    expect((await currentBatch()).sync_lease_token).toBe(successor);
    expect((await currentBatch()).xero_invoice_id).toBeNull();
    expect((await currentBatch()).sync_status).not.toBe('completed');
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'accounting_busy' });
    await expireLease();
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'external_result_unconfirmed' });
    expect(postCounts()).toEqual({ invoice: 1, payment: 0, fee: 0, journal: 0 });
  });

  it.each(['tenant', 'business'] as const)('does not finalize or start another financial stage after %s pause', async pause => {
    providerHook = async stage => {
      if (stage !== 'invoice') return;
      if (pause === 'tenant') await tenant.execute('UPDATE ims_online_sync_control SET paused = 1 WHERE business_id = ?', [input.businessId]);
      else await main.execute('UPDATE businesses SET automation_paused = 1 WHERE business_id = ?', [input.businessId]);
    };
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({
      status: 'blocked', reason: pause === 'tenant' ? 'paused' : 'business_automation_paused',
    });
    expect((await currentBatch()).sync_status).not.toBe('completed');
    expect(postCounts()).toEqual({ invoice: 1, payment: 0, fee: 0, journal: 0 });
  });

  it('replays cross-database dirty evidence after a main commit/tenant acknowledgement crash', async () => {
    const generation = randomUUID();
    await dirtyDay(generation);
    failDirtyAck = true;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry' });
    expect((await currentBatch()).sync_source_generation).toBe(generation);
    expect((await rows(tenant, 'SELECT propagated_generation FROM ims_online_day_changes'))[0].propagated_generation).toBeNull();
    expect(postCounts()).toEqual({ invoice: 0, payment: 0, fee: 0, journal: 0 });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect((await currentBatch()).sync_review_reason).toBeNull();
    expect((await rows(tenant, 'SELECT propagated_generation FROM ims_online_day_changes'))[0].propagated_generation).toBe(generation);
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('does not acknowledge a newer dirty generation with an older cross-database CAS', async () => {
    await dirtyDay(randomUUID());
    const replacement = randomUUID();
    newerGenerationDuringAck = replacement;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(ackAffectedRows[0]).toBe(0);
    expect(ackAffectedRows.slice(1)).toContain(1);
    expect((await currentBatch()).sync_source_generation).toBe(replacement);
    expect((await currentBatch()).invoice_total).toBe('121.00');
    expect((await rows(tenant, 'SELECT generation, propagated_generation FROM ims_online_day_changes'))[0])
      .toMatchObject({ generation: replacement, propagated_generation: replacement });
  });

  it('forces posted-day review for transactionally changed financial facts without replacing frozen input', async () => {
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    const before = await currentBatch();
    const generation = randomUUID();
    await dirtyDay(generation, true);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review' });
    const after = await currentBatch();
    expect(after.sync_review_reason).toBe('posted_day_changed');
    expect(after.sync_source_generation).toBe(generation);
    expect(after.sync_input_hash).toBe(before.sync_input_hash);
    expect(after.sync_input_json).toEqual(before.sync_input_json);
    expect(after.xero_invoice_id).toBe('invoice-test');
    expect(after.invoice_total).toBe('110.00');
    expect((await rows(tenant, 'SELECT propagated_generation FROM ims_online_day_changes'))[0].propagated_generation).toBe(generation);
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('detects a changed posted GST/source snapshot independently of dirty-generation delivery', async () => {
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    const before = await currentBatch();
    await tenant.execute('UPDATE ims_sales_orders SET tax_amount = 0 WHERE business_id = ?', [input.businessId]);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'accounting_input_changed' });
    expect((await currentBatch()).sync_input_hash).toBe(before.sync_input_hash);
    expect(postCounts()).toEqual({ invoice: 1, payment: 1, fee: 1, journal: 1 });
  });

  it('honours durable dirty reviews and sticky quarantine despite completed coverage', async () => {
    await tenant.execute(
      `INSERT INTO ims_shopify_order_recovery (business_id, channel_instance_id, external_order_id, applied_hash, review_reason)
       VALUES (?, ?, '123', ?, 'provider_version_conflict')`, [input.businessId, input.channelInstanceId, 'a'.repeat(64)],
    );
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'order_review_required' });
    await tenant.execute('DELETE FROM ims_shopify_order_recovery');
    await dirtyDay(randomUUID());
    await tenant.execute('UPDATE ims_online_day_changes SET propagated_generation = generation, review_reason = ?', ['source_conflict']);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'source_conflict', reviewRequired: true });
    expect(postCounts()).toEqual({ invoice: 0, payment: 0, fee: 0, journal: 0 });
  });

  it('leaves known older reviews held without blocking an unrelated verified accounting day', async () => {
    await tenant.execute("UPDATE ims_sales_orders SET order_date='2020-01-02' WHERE business_id=?", [input.businessId]);
    await tenant.execute(`INSERT INTO ims_shopify_order_recovery
      (business_id,channel_instance_id,external_order_id,review_reason) VALUES (?,?,'123','source_provenance_conflict')`,
    [input.businessId, input.channelInstanceId]);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: true });
    expect((await rows(tenant, 'SELECT review_reason FROM ims_shopify_order_recovery'))[0].review_reason)
      .toBe('source_provenance_conflict');
    await tenant.execute('UPDATE ims_sales_orders SET order_date=? WHERE business_id=?', [input.date, input.businessId]);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'order_review_required' });
  });

  it('does not certify an unowned review as unrelated to the accounting day', async () => {
    await tenant.execute(`INSERT INTO ims_shopify_order_recovery
      (business_id,channel_instance_id,external_order_id,review_reason) VALUES (?,?,'999','source_provenance_conflict')`,
    [input.businessId, input.channelInstanceId]);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'order_review_required' });
  });

  it('creates no posting state or provider request for accounting before its start date', async () => {
    await main.execute(`UPDATE sales_channel_instances
      SET settings_json=JSON_SET(settings_json,'$.shopify.xero.dailyAccountingFrom','2020-01-04')
      WHERE business_id=? AND channel_instance_id=?`, [input.businessId, input.channelInstanceId]);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'before_accounting_start' });
    expect(await rows(main, 'SELECT batch_date FROM xero_online_batches')).toHaveLength(0);
    expect(postCounts()).toEqual({ invoice: 0, payment: 0, fee: 0, journal: 0 });
  });
  it('blocks a stale completed baseline when the configured eligible history moves earlier', async () => {
    await main.execute(
      "UPDATE sales_channel_instances SET settings_json = JSON_SET(settings_json, '$.shopify.orders.syncFrom', '2019-12-01') WHERE channel_instance_id = ?",
      [input.channelInstanceId],
    );
    expect(await runOnlineDailyAccountingRecovery({ ...input, manual: true })).toMatchObject({ status: 'blocked', reason: 'rebaseline_required' });
    expect((await rows(tenant, 'SELECT baseline_from, baseline_complete FROM ims_shopify_reconciliation'))[0])
      .toMatchObject({ baseline_from: expect.stringMatching(/^2020-01-01 00:00:00(?:\.000)?$/), baseline_complete: 1 });
    expect(postCounts()).toEqual({ invoice: 0, payment: 0, fee: 0, journal: 0 });
  });
});
