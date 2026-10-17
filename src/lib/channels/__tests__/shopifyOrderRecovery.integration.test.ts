import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSchemaStatements } from '@/lib/ims/provisionBusiness';
import type { OnlineSyncSqlValue } from '../onlineSyncJobs';

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), query: vi.fn(), execute: vi.fn(), main: vi.fn(),
  syncCN: vi.fn(), reverseRefund: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('Unexpected provider or main-database mutation.'); }),
}));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: mocks.pool, imsQuery: mocks.query, imsExecute: mocks.execute,
}));
vi.mock('@/services/MySQLService', () => ({
  query: mocks.main, execute: mocks.forbidden, getPool: mocks.forbidden,
}));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: async () => 'UTC' }));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerCNXeroSync: mocks.forbidden, syncCNXeroWithOutcome: mocks.syncCN,
  triggerSOXeroSync: mocks.forbidden,
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: { reverseRefund: mocks.reverseRefund, awardPaidOrder: mocks.forbidden },
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mocks.forbidden },
}));
import { applyShopifyRecoverySnapshot } from '../shopifyOrderRecovery';
import { recoverShopifyRefundDownstreamEffects } from '../shopifyOrderRecoveryEffects';

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `online_lifecycle_test_${randomUUID().replaceAll('-', '')}`;
const mainSchema = `online_proof_test_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
let mainPool: Pool;
async function rows(sql: string) { return (await pool.query<RowDataPacket[]>(sql))[0]; }
function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: '123', name: '#123', created_at: now, updated_at: now, currency: 'AUD', taxes_included: true,
    financial_status: 'paid', fulfillment_status: null, cancelled_at: null,
    subtotal_price: '33.00', total_price: '33.00', total_tax: '3.00', total_discounts: '0.00',
    total_shipping_price_set: { shop_money: { amount: '0.00', currency_code: 'AUD' } },
    payment_gateway_names: ['shopify_payments'], customer: null, shipping_lines: [],
    line_items: [{
      id: '9001', variant_id: '6001', title: 'Shirt', sku: 'SHIRT', quantity: 3, current_quantity: 3,
      price: '11.00', total_discount: '0.00', tax_lines: [{ rate: 0.1, price: '3.00' }],
    }],
    fulfillments: [], refunds: [], ...overrides,
  };
}
function recover(order = source()) {
  return applyShopifyRecoverySnapshot({
    businessId: 'alpha', channelInstanceId: 'store', locationId: 4,
    order, syncFrom: '2026-01-01', deadline: Date.now() + 45_000,
  });
}
async function facts() {
  const [[stock], [order], [counts]] = await Promise.all([
    rows('SELECT qty_on_hand,qty_committed FROM ims_stock'),
    rows('SELECT total_amount,tax_amount,status FROM ims_sales_orders'),
    rows(`SELECT (SELECT COUNT(*) FROM ims_online_day_changes) AS dirty,
      (SELECT COUNT(*) FROM ims_sales_channel_jobs) AS jobs,
      (SELECT COUNT(*) FROM ims_credit_notes) AS notes,
      (SELECT COUNT(*) FROM ims_stock_movements) AS movements`),
  ]);
  return {
    stock: Number(stock.qty_on_hand), committed: Number(stock.qty_committed),
    total: order ? Number(order.total_amount) : null, tax: order ? Number(order.tax_amount) : null,
    status: order?.status ?? null, dirty: Number(counts.dirty), jobs: Number(counts.jobs),
    notes: Number(counts.notes), movements: Number(counts.movements),
  };
}

describe.skipIf(!port)('complete Shopify lifecycle orchestration on real MySQL (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit loopback test port required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      await server.query(`CREATE DATABASE \`${schema}\``);
      await server.query(`CREATE DATABASE \`${mainSchema}\``);
    } finally { await server.end(); }
    pool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: schema,
      connectionLimit: 6, timezone: 'Z', dateStrings: true,
    });
    mainPool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: mainSchema,
      connectionLimit: 2, timezone: 'Z', dateStrings: true,
    });
    await mainPool.query(`CREATE TABLE xero_sync_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, business_id VARCHAR(255) NOT NULL,
      sync_type VARCHAR(30) NOT NULL, reference_id INT, xero_id VARCHAR(100),
      status VARCHAR(20) NOT NULL, xero_state VARCHAR(20))`);
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
    mocks.syncCN.mockImplementation(mocks.forbidden);
    mocks.reverseRefund.mockImplementation(mocks.forbidden);
    await mainPool.query('TRUNCATE TABLE xero_sync_log');
    await pool.query('DROP TRIGGER IF EXISTS test_expire_lifecycle');
    const connection = await pool.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of [
        'ims_so_shipment_tracking', 'ims_so_shipment_items', 'ims_so_shipments', 'ims_so_fulfilment_operations',
        'ims_credit_note_items', 'ims_credit_notes', 'ims_stock_movements', 'ims_stock_allocations',
        'ims_stock', 'ims_sales_order_items', 'ims_sales_orders', 'ims_sales_channel_product_mappings',
        'ims_product_variants', 'ims_products', 'ims_locations', 'ims_inventory_cost_state',
        'ims_shopify_order_recovery', 'ims_online_sync_control', 'ims_online_day_changes',
        'ims_sales_channel_jobs', 'ims_contact_channel_mappings', 'ims_contacts',
      ]) await connection.query(`TRUNCATE TABLE ${table}`);
    } finally { await connection.query('SET FOREIGN_KEY_CHECKS = 1'); connection.release(); }
    await pool.query("INSERT INTO ims_online_sync_control (business_id,rollout_state) VALUES ('alpha','validation')");
    await pool.query("INSERT INTO ims_locations (id,business_id,name) VALUES (4,'alpha','Test store')");
    await pool.query("INSERT INTO ims_products (business_id,product_id,name) VALUES ('alpha','product','Shirt')");
    await pool.query(`INSERT INTO ims_product_variants
      (business_id,variant_id,product_id,sku,shopify_variant_id,avg_cost,cost_aud)
      VALUES ('alpha','variant','product','SHIRT','6001',5,5)`);
    await pool.query(`INSERT INTO ims_sales_channel_product_mappings
      (business_id,channel_instance_id,variant_id,external_variant_id)
      VALUES ('alpha','store','variant','6001')`);
    await pool.query(`INSERT INTO ims_stock (business_id,variant_id,location_id,qty_on_hand,qty_committed)
      VALUES ('alpha','variant',4,10,3)`);
    await pool.query(`INSERT INTO ims_sales_orders
      (id,business_id,so_number,so_type,sales_channel,channel_instance_id,external_order_id,
       location_id,status,order_date,subtotal,tax_amount,total_amount,financial_status,payment_gateway,tax_treatment)
      VALUES (44,'alpha','SO-44','online','shopify','store','123',4,'confirmed',UTC_DATE(),30,3,33,'paid','shopify_payments','inc_tax')`);
    await pool.query(`INSERT INTO ims_sales_order_items
      (id,business_id,so_id,external_order_item_id,variant_id,qty_ordered,unit_price,unit_cost,line_total,tax_rate)
      VALUES (55,'alpha',44,'9001','variant',3,11,5,33,10)`);
    mocks.pool.mockReturnValue(pool);
    mocks.main.mockResolvedValue([{ business_id: 'alpha' }]);
    mocks.query.mockImplementation(async (sql: string, params: OnlineSyncSqlValue[] = []) =>
      (await pool.execute<RowDataPacket[]>(sql, params))[0]);
    mocks.execute.mockImplementation(async (sql: string, params: OnlineSyncSqlValue[] = []) =>
      (await pool.execute<ResultSetHeader>(sql, params))[0]);
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.end();
    await mainPool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      await server.query(`DROP DATABASE \`${schema}\``);
      await server.query(`DROP DATABASE \`${mainSchema}\``);
    } finally { await server.end(); }
  });

  it('atomically updates financial facts, dirty generation and exact-hash handoff, then skips replay', async () => {
    const order = source({
      subtotal_price: '36.30', total_price: '36.30', total_tax: '3.30',
      line_items: [{
        id: '9001', variant_id: '6001', title: 'Shirt', sku: 'SHIRT', quantity: 3, current_quantity: 3,
        price: '12.10', total_discount: '0.00', tax_lines: [{ rate: 0.1, price: '3.30' }],
      }],
    });
    expect(await recover(order)).toBe('applied');
    expect(await facts()).toMatchObject({ stock: 10, committed: 3, total: 36.3, tax: 3.3, dirty: 1, jobs: 1 });
    const before = await facts();
    expect(await recover(order)).toBe('already_current');
    expect(await facts()).toEqual(before);
    const [recovery] = await rows('SELECT applied_hash,effects_json FROM ims_shopify_order_recovery');
    expect(recovery.applied_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });
  it('rolls financial and dirty-day writes back with the receipt if the final order fence expires', async () => {
    await pool.query(`CREATE TRIGGER test_expire_lifecycle BEFORE UPDATE ON ims_sales_orders
      FOR EACH ROW UPDATE ims_shopify_order_recovery
      SET lease_expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND
      WHERE business_id=NEW.business_id AND channel_instance_id=NEW.channel_instance_id
        AND external_order_id=NEW.external_order_id`);
    const before = await facts();
    await expect(recover(source({ total_price: '44.00' }))).rejects.toThrow('no longer owned');
    expect(await facts()).toEqual(before);
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });
  it('preserves original refunded quantities and lets only the CN owner restock', async () => {
    await pool.query("UPDATE ims_sales_orders SET status='fulfilled' WHERE id=44");
    await pool.query('UPDATE ims_sales_order_items SET qty_fulfilled=3');
    await pool.query('UPDATE ims_stock SET qty_on_hand=7,qty_committed=0');
    const order = source({
      financial_status: 'partially_refunded', fulfillment_status: 'fulfilled',
      line_items: [{
        id: '9001', variant_id: '6001', title: 'Shirt', sku: 'SHIRT', quantity: 3, current_quantity: 1,
        price: '11.00', total_discount: '0.00', tax_lines: [{ rate: 0.1, price: '3.00' }],
      }],
      refunds: [{
        id: '8001', transactions: [{ kind: 'refund', status: 'success', amount: '22.00', gateway: 'shopify_payments' }],
        refund_line_items: [{
          line_item_id: '9001', quantity: 2, subtotal: '20.00', total_tax: '2.00', restock_type: 'return',
          line_item: { id: '9001', variant_id: '6001', sku: 'SHIRT', title: 'Shirt' },
        }],
      }],
    });
    expect(await recover(order)).toBe('applied');
    expect(await facts()).toMatchObject({ stock: 9, committed: 0, notes: 1, movements: 1, total: 33 });
    expect(Number((await rows('SELECT qty_ordered FROM ims_sales_order_items'))[0].qty_ordered)).toBe(3);
    expect(await recover(order)).toBe('already_current');
    expect(await facts()).toMatchObject({ stock: 9, notes: 1, movements: 1 });
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });
  it('atomically quarantines historical stock uncertainty without inventing an order or movement', async () => {
    await pool.query('DELETE FROM ims_sales_orders');
    expect(await recover(source({
      created_at: '2026-01-02T00:00:00Z', fulfillments: [{ id: '7001', status: 'success' }],
    }))).toBe('review');
    expect(await facts()).toMatchObject({ stock: 10, status: null, movements: 0, jobs: 0, dirty: 1 });
    expect((await rows('SELECT review_reason FROM ims_online_day_changes'))[0].review_reason)
      .toBe('historical_stock_evidence_missing');
    expect((await rows('SELECT review_reason FROM ims_shopify_order_recovery'))[0].review_reason)
      .toBe('historical_stock_evidence_missing');
  });
  it('imports a missing current-day order and commits its stock once', async () => {
    await pool.query('DELETE FROM ims_sales_orders');
    await pool.query('UPDATE ims_stock SET qty_committed=0');
    const order = source();
    expect(await recover(order)).toBe('applied');
    expect(await facts()).toMatchObject({ stock: 10, committed: 3, status: 'confirmed', total: 33, jobs: 1 });
    expect(await recover(order)).toBe('already_current');
    expect(await facts()).toMatchObject({ committed: 3, jobs: 1 });
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });

  it.each([1, 2])('quarantines %i historically fulfilled units without scoped receipts before stock replay', async fulfilled => {
    await pool.query("UPDATE ims_sales_orders SET status='partially_fulfilled' WHERE id=44");
    await pool.execute('UPDATE ims_sales_order_items SET qty_fulfilled=?', [fulfilled]);
    await pool.execute('UPDATE ims_stock SET qty_on_hand=?,qty_committed=?', [10 - fulfilled, 3 - fulfilled]);
    await pool.execute(`INSERT INTO ims_so_fulfilment_operations
      (business_id,operation_key,request_hash,so_id,status,request_json)
      VALUES ('alpha','shopify:fulfillments/create:7001',?,44,'complete',?)`, [
      '0'.repeat(64), JSON.stringify({ shipmentQuantities: [{ itemId: 55, quantity: fulfilled }] }),
    ]);
    const before = await facts();
    expect(await recover(source({
      fulfillment_status: 'partial',
      fulfillments: [{ id: '7001', status: 'success', line_items: [{ id: '9001', quantity: fulfilled }] }],
    }))).toBe('review');
    expect(await facts()).toMatchObject({ stock: before.stock, committed: before.committed, movements: 0 });
    expect(Number((await rows('SELECT qty_fulfilled FROM ims_sales_order_items'))[0].qty_fulfilled)).toBe(fulfilled);
    expect((await rows('SELECT review_reason FROM ims_shopify_order_recovery'))[0].review_reason)
      .toBe('source_provenance_conflict');
  });

  it('continues known partial shipments without replaying their committed stock', async () => {
    const first = source({
      fulfillment_status: 'partial',
      fulfillments: [{ id: '7001', status: 'success', line_items: [{ id: '9001', quantity: 1 }] }],
    });
    expect(await recover(first)).toBe('applied');
    const second = {
      ...first, updated_at: new Date(Date.parse(String(first.updated_at)) + 1000).toISOString(),
      fulfillments: [
        { id: '7001', status: 'success', line_items: [{ id: '9001', quantity: 1 }] },
        { id: '7002', status: 'success', line_items: [{ id: '9001', quantity: 1 }] },
      ],
    };
    expect(await recover(second)).toBe('applied');
    expect(await recover(second)).toBe('already_current');
    expect(await facts()).toMatchObject({ stock: 8, committed: 1, movements: 2 });
  });

  it('uses explicit shipments without fulfilling a cancelled unit through the whole-order fallback', async () => {
    await pool.query('UPDATE ims_sales_order_items SET tax_rate=0.1');
    await pool.query('UPDATE ims_stock SET qty_committed=2');
    await pool.query('UPDATE ims_sales_orders SET refunded_amount=11');
    await pool.query(`INSERT INTO ims_credit_notes
      (id,business_id,cn_number,so_id,location_id,status,source,channel_instance_id,
       external_refund_id,cn_date,subtotal,tax_amount,total_amount)
      VALUES (71,'alpha','CN-71',44,4,'complete','shopify','store','8001',UTC_DATE(),10,1,11)`);
    const order = source({
      financial_status: 'partially_refunded', fulfillment_status: 'fulfilled',
      line_items: [{
        id: '9001', variant_id: '6001', title: 'Shirt', sku: 'SHIRT', quantity: 3, current_quantity: 2,
        price: '11.00', total_discount: '0.00', tax_lines: [{ rate: 0.1, price: '3.00' }],
      }],
      fulfillments: [{ id: '7001', status: 'success', line_items: [{ id: '9001', quantity: 2 }] }],
      refunds: [{
        id: '8001', transactions: [{ kind: 'refund', status: 'success', amount: '11.00' }],
        refund_line_items: [{ line_item_id: '9001', quantity: 1, subtotal: '10.00', total_tax: '1.00', restock_type: 'cancel' }],
      }],
    });
    expect(await recover(order)).toBe('applied');
    expect(await facts()).toMatchObject({ stock: 8, committed: 0, movements: 1, notes: 1 });
    expect(await recover(order)).toBe('already_current');
    expect(await facts()).toMatchObject({ stock: 8, movements: 1, notes: 1 });
  });

  it.each([
    ['alpha', 71, 'xero-cn-71', 'success', 'AUTHORISED', true],
    ['beta', 71, 'xero-cn-71', 'success', 'AUTHORISED', false],
    ['alpha', 72, 'xero-cn-71', 'success', 'AUTHORISED', false],
    ['alpha', 71, 'other-xero-cn', 'success', 'AUTHORISED', false],
    ['alpha', 71, 'xero-cn-71', 'error', 'AUTHORISED', false],
    ['alpha', 71, 'xero-cn-71', 'success', 'DRAFT', false],
  ])('verifies refund posting across separate schemas: %s/%s/%s/%s/%s', async (
    businessId, referenceId, xeroId, status, xeroState, completed,
  ) => {
    expect(await rows("SHOW TABLES LIKE 'xero_sync_log'")).toEqual([]);
    await pool.query(`INSERT INTO ims_credit_notes
      (id,business_id,cn_number,so_id,location_id,status,source,channel_instance_id,
       external_refund_id,cn_date,subtotal,tax_amount,total_amount,xero_credit_note_id,xero_sync_status)
      VALUES (71,'alpha','CN-71',44,4,'complete','shopify','store','8001',UTC_DATE(),10,1,11,'xero-cn-71','synced')`);
    await mainPool.execute(`INSERT INTO xero_sync_log
      (business_id,reference_id,xero_id,sync_type,status,xero_state) VALUES (?,?,?,'cn_credit_note',?,?)`,
    [businessId, referenceId, xeroId, status, xeroState]);
    mocks.main.mockImplementation(async (sql: string, params: OnlineSyncSqlValue[] = []) =>
      (await mainPool.execute<RowDataPacket[]>(sql, params))[0]);
    mocks.reverseRefund.mockResolvedValue({ status: 'skipped', reason: 'original_award_not_found' });
    mocks.syncCN.mockResolvedValue({ status: 'linked', xeroId: 'xero-cn-71' });
    const input = {
      businessId: 'alpha', channelInstanceId: 'store', creditNoteId: 71,
      refund: {
        id: '8001', order_id: '123',
        transactions: [{ kind: 'refund', status: 'success', amount: '11.00' }],
        refund_line_items: [{ subtotal: '10.00', total_tax: '1.00' }],
      },
    };
    const before = await facts();
    const expected = completed ? { status: 'completed' }
      : { status: 'blocked', reason: 'accounting_completion_unverified' };
    expect(await recoverShopifyRefundDownstreamEffects(input)).toEqual(expected);
    expect(await recoverShopifyRefundDownstreamEffects(input)).toEqual(expected);
    expect(await facts()).toEqual(before);
    expect(mocks.main).toHaveBeenCalledWith(expect.stringContaining('FROM xero_sync_log'), ['alpha', 71, 'xero-cn-71']);
    expect(mocks.forbidden).not.toHaveBeenCalled();
  });
});
