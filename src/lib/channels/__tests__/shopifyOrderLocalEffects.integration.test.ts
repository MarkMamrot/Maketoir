import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSchemaStatements } from '@/lib/ims/provisionBusiness';
import type { OnlineSyncSql } from '../onlineSyncJobs';
import { OnlineSyncLeaseLostError } from '../onlineSyncPolicy';
import { claimShopifyOrderSnapshot, releaseShopifyOrderLease, type ShopifyOrderLease } from '../shopifyOrderCoordination';
import { applyCoordinatedShopifyRefund, applyCoordinatedShopifyFulfilment } from '../shopifyOrderLocalEffects';
import { applyShopifyOrderRefundInTransaction } from '../shopifyOrderRefund';

const forbidden = vi.hoisted(() => vi.fn(() => {
  throw new Error('Unexpected global database access, nested transaction or provider call.');
}));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: forbidden, imsQuery: forbidden, imsExecute: forbidden,
}));
vi.mock('@/services/MySQLService', () => ({
  getPool: forbidden, query: forbidden, execute: forbidden,
}));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerCNXeroSync: forbidden, syncCNXeroWithOutcome: forbidden,
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: { reverseRefund: forbidden },
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: forbidden },
}));

const port = Number(process.env.ONLINE_SYNC_TEST_PORT);
const password = process.env.ONLINE_SYNC_TEST_PASSWORD ?? '';
const schema = `online_effect_test_${randomUUID().replaceAll('-', '')}`;
const source = {
  businessId: 'alpha', channelInstanceId: 'store', externalOrderId: '123',
  updatedAt: '2026-10-17T01:00:00.000Z', hash: 'a'.repeat(64),
};
const fulfilment = {
  id: 7001, order_id: 123, status: 'success',
  line_items: [{ id: 9001, quantity: 2 }],
  tracking_number: 'TRACK-1', tracking_company: 'Carrier',
};
const refund = {
  id: 8001, order_id: 123,
  transactions: [{ kind: 'refund', status: 'success', amount: '22.00', gateway: 'shopify_payments' }],
  refund_line_items: [{
    line_item_id: 9001, quantity: 2, subtotal: '20.00', total_tax: '2.00', restock_type: 'return',
    line_item: { id: 9001, variant_id: 6001, title: 'Shirt', sku: 'SHIRT' },
  }],
};
let pool: Pool;
let sql: OnlineSyncSql;

async function claim(required: string[]): Promise<ShopifyOrderLease> {
  const result = await claimShopifyOrderSnapshot(source, required, sql);
  if (result.status !== 'ready') throw new Error(`Expected ready isolated order claim, got ${result.status}.`);
  return result.lease;
}

async function facts() {
  const [[row]] = await pool.query<RowDataPacket[]>(`
    SELECT s.qty_on_hand, s.qty_committed, so.status, so.refunded_amount, so.financial_status,
      soi.qty_fulfilled,
      (SELECT COUNT(*) FROM ims_stock_movements) AS movements,
      (SELECT COUNT(*) FROM ims_credit_notes) AS notes,
      (SELECT COUNT(*) FROM ims_credit_note_items) AS note_items,
      (SELECT COUNT(*) FROM ims_so_shipments) AS shipments,
      (SELECT COUNT(*) FROM ims_so_shipment_items) AS shipment_items,
      (SELECT COUNT(*) FROM ims_so_shipment_tracking) AS tracking,
      (SELECT COUNT(*) FROM ims_so_fulfilment_operations) AS operations,
      (SELECT JSON_LENGTH(effects_json, '$.effects') FROM ims_shopify_order_recovery
        WHERE business_id = 'alpha' AND channel_instance_id = 'store' AND external_order_id = '123') AS receipts
    FROM ims_stock s JOIN ims_sales_orders so ON so.location_id = s.location_id
    JOIN ims_sales_order_items soi ON soi.so_id = so.id
    WHERE so.id = 44 AND s.variant_id = 'variant'`);
  return {
    stock: Number(row.qty_on_hand), committed: Number(row.qty_committed),
    status: row.status, refunded: Number(row.refunded_amount), financialStatus: row.financial_status,
    fulfilled: Number(row.qty_fulfilled), movements: Number(row.movements), notes: Number(row.notes),
    noteItems: Number(row.note_items), shipments: Number(row.shipments), shipmentItems: Number(row.shipment_items),
    tracking: Number(row.tracking), operations: Number(row.operations), receipts: Number(row.receipts),
  };
}

async function prepareRefundOrder() {
  await pool.query("UPDATE ims_sales_orders SET status = 'fulfilled' WHERE id = 44");
  await pool.query('UPDATE ims_sales_order_items SET qty_fulfilled = 3 WHERE so_id = 44');
  await pool.query('UPDATE ims_stock SET qty_on_hand = 7, qty_committed = 0');
}

async function persistExistingRefund() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await applyShopifyOrderRefundInTransaction(connection, {
      businessId: 'alpha', channelInstanceId: 'store', refund,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function expireFenceDuringDomainWrite() {
  await pool.query(`CREATE TRIGGER test_expire_order_fence BEFORE UPDATE ON ims_sales_orders
    FOR EACH ROW UPDATE ims_shopify_order_recovery
      SET lease_expires_at = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3))
      WHERE business_id = NEW.business_id AND channel_instance_id = NEW.channel_instance_id
        AND external_order_id = NEW.external_order_id`);
}

describe.skipIf(!port)('real Shopify domain effects and receipts on MySQL (loopback only)', () => {
  beforeAll(async () => {
    if (!Number.isSafeInteger(port) || port <= 0) throw new Error('Explicit local MySQL test port required.');
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try { await server.query(`CREATE DATABASE \`${schema}\``); } finally { await server.end(); }
    pool = mysql.createPool({
      host: '127.0.0.1', port, user: 'root', password, database: schema,
      connectionLimit: 6, timezone: 'Z', dateStrings: true,
    });
    const connection = await pool.getConnection();
    try {
      const canonical = await readFile(path.join(process.cwd(), 'scripts', 'ims-schema.sql'), 'utf8');
      for (const statement of parseSchemaStatements(canonical)) await connection.query(statement);
    } finally { connection.release(); }
    const connections = await Promise.all(Array.from({ length: 6 }, () => pool.getConnection()));
    try { await Promise.all(connections.map(connection => connection.query("SET time_zone = '+11:00'"))); }
    finally { connections.forEach(connection => connection.release()); }
    sql = {
      query: async (statement, params) => {
        const [rows] = await pool.execute<RowDataPacket[]>(statement, params);
        return rows;
      },
      execute: async (statement, params) => {
        const [result] = await pool.execute<ResultSetHeader>(statement, params);
        return result;
      },
    };
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    await pool.query('DROP TRIGGER IF EXISTS test_expire_order_fence');
    await pool.query('DROP TRIGGER IF EXISTS test_fail_shipment');
    const connection = await pool.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of [
        'ims_so_shipment_tracking', 'ims_so_shipment_items', 'ims_so_shipments', 'ims_so_fulfilment_operations',
        'ims_credit_note_items', 'ims_credit_notes', 'ims_stock_movements', 'ims_stock_allocations',
        'ims_stock', 'ims_sales_order_items', 'ims_sales_orders', 'ims_product_variants', 'ims_products',
        'ims_locations', 'ims_inventory_cost_state', 'ims_shopify_order_recovery', 'ims_online_sync_control',
      ]) await connection.query(`TRUNCATE TABLE ${table}`);
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      connection.release();
    }
    await pool.query("INSERT INTO ims_online_sync_control (business_id, rollout_state) VALUES ('alpha','validation')");
    await pool.query("INSERT INTO ims_locations (id,business_id,name) VALUES (4,'alpha','Test store')");
    await pool.query("INSERT INTO ims_products (business_id,product_id,name) VALUES ('alpha','product','Shirt')");
    await pool.query(`INSERT INTO ims_product_variants
      (business_id,variant_id,product_id,sku,shopify_variant_id,avg_cost,cost_aud)
      VALUES ('alpha','variant','product','SHIRT','6001',5,5)`);
    await pool.query(`INSERT INTO ims_stock (business_id,variant_id,location_id,qty_on_hand,qty_committed)
      VALUES ('alpha','variant',4,10,3)`);
    await pool.query(`INSERT INTO ims_sales_orders
      (id,business_id,so_number,so_type,sales_channel,channel_instance_id,external_order_id,
       location_id,status,order_date,total_amount,financial_status,payment_gateway)
      VALUES (44,'alpha','SO-44','online','shopify','store','123',4,'confirmed','2026-10-17',33,'paid','shopify_payments')`);
    await pool.query(`INSERT INTO ims_sales_order_items
      (id,business_id,so_id,external_order_item_id,variant_id,qty_ordered,unit_price,unit_cost,line_total)
      VALUES (55,'alpha',44,'9001','variant',3,11,5,33)`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    const server = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password });
    try {
      if (!/^online_effect_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe isolated schema cleanup target.');
      await server.query(`DROP DATABASE \`${schema}\``);
    } finally { await server.end(); }
  });

  it('commits partial stock, shipment and receipt once, including concurrent replay', async () => {
    const lease = await claim(['fulfilment:7001']);
    const results = await Promise.all(Array.from({ length: 2 }, () => applyCoordinatedShopifyFulfilment(
      lease, { topic: 'fulfillments/create', payload: fulfilment }, pool,
    )));
    expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
    expect(await facts()).toMatchObject({
      stock: 8, committed: 1, fulfilled: 2, status: 'partially_fulfilled',
      movements: 1, shipments: 1, shipmentItems: 1, tracking: 1, operations: 1, receipts: 1,
    });
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('rolls stock, shipment, operation and receipt back together if the final fence fails', async () => {
    const lease = await claim(['fulfilment:7001']);
    const before = await facts();
    await expireFenceDuringDomainWrite();
    await expect(applyCoordinatedShopifyFulfilment(lease, {
      topic: 'fulfillments/create', payload: fulfilment,
    }, pool)).rejects.toThrow(OnlineSyncLeaseLostError);
    expect(await facts()).toEqual(before);
    await pool.query('DROP TRIGGER test_expire_order_fence');
    await applyCoordinatedShopifyFulfilment(lease, { topic: 'fulfillments/create', payload: fulfilment }, pool);
    expect(await facts()).toMatchObject({ stock: 8, movements: 1, shipments: 1, receipts: 1 });
  });

  it('rolls back stock and the fulfilment operation if shipment persistence fails', async () => {
    const lease = await claim(['fulfilment:7001']);
    const before = await facts();
    await pool.query(`CREATE TRIGGER test_fail_shipment BEFORE INSERT ON ims_so_shipments
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected shipment failure'`);
    await expect(applyCoordinatedShopifyFulfilment(lease, {
      topic: 'fulfillments/create', payload: fulfilment,
    }, pool)).rejects.toThrow('Injected shipment failure');
    expect(await facts()).toEqual(before);
  });

  it('uses only the outstanding fallback quantity and updates tracking without further stock', async () => {
    const lease = await claim(['fulfilment:7001', 'order_fulfilment', 'shipment:7001']);
    await applyCoordinatedShopifyFulfilment(lease, { topic: 'fulfillments/create', payload: fulfilment }, pool);
    await applyCoordinatedShopifyFulfilment(lease, { topic: 'orders/fulfilled', payload: { id: 123 } }, pool);
    await applyCoordinatedShopifyFulfilment(lease, {
      topic: 'fulfillments/update', payload: { ...fulfilment, tracking_number: 'TRACK-2' },
    }, pool);
    expect(await facts()).toMatchObject({
      stock: 7, committed: 0, fulfilled: 3, status: 'fulfilled',
      movements: 2, shipments: 1, tracking: 1, receipts: 3,
    });
    const [[tracking]] = await pool.query<RowDataPacket[]>('SELECT tracking_number FROM ims_so_shipment_tracking');
    expect(tracking.tracking_number).toBe('TRACK-2');
  });

  it('commits one exact refund, stock return and receipt, surviving worker replacement', async () => {
    await prepareRefundOrder();
    const lease = await claim(['refund:8001', 'order_record']);
    const first = await applyCoordinatedShopifyRefund(lease, refund, pool);
    expect(first.duplicate).toBe(false);
    const committed = await facts();
    expect(committed).toMatchObject({
      stock: 9, refunded: 22, financialStatus: 'partially_refunded',
      movements: 1, notes: 1, noteItems: 1, receipts: 1,
    });
    await releaseShopifyOrderLease(lease, sql);
    const replacement = await claim(['refund:8001', 'order_record']);
    expect((await applyCoordinatedShopifyRefund(replacement, refund, pool)).duplicate).toBe(true);
    expect(await facts()).toEqual(committed);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('rolls CN, return stock, financial status and receipt back together on lost fence', async () => {
    await prepareRefundOrder();
    const lease = await claim(['refund:8001']);
    const before = await facts();
    await expireFenceDuringDomainWrite();
    await expect(applyCoordinatedShopifyRefund(lease, refund, pool)).rejects.toThrow(OnlineSyncLeaseLostError);
    expect(await facts()).toEqual(before);
    await pool.query('DROP TRIGGER test_expire_order_fence');
    await applyCoordinatedShopifyRefund(lease, refund, pool);
    expect(await facts()).toMatchObject({ stock: 9, refunded: 22, movements: 1, notes: 1, receipts: 1 });
  });

  it('keeps value-only refunds from returning stock', async () => {
    await prepareRefundOrder();
    const lease = await claim(['refund:8001']);
    await applyCoordinatedShopifyRefund(lease, {
      ...refund, refund_line_items: [{ ...refund.refund_line_items[0], restock_type: 'no_restock' }],
    }, pool);
    expect(await facts()).toMatchObject({ stock: 7, refunded: 22, notes: 1, movements: 0, receipts: 1 });
  });

  it.each(['none', 'amount', 'order', 'status'])('verifies pre-existing CN evidence without restocking (conflict: %s)', async conflict => {
    await prepareRefundOrder();
    await persistExistingRefund();
    if (conflict === 'amount') await pool.query('UPDATE ims_credit_notes SET total_amount = 21');
    if (conflict === 'status') await pool.query("UPDATE ims_credit_notes SET status = 'draft'");
    if (conflict === 'order') {
      await pool.query(`INSERT INTO ims_sales_orders
        (id,business_id,so_number,location_id,order_date) VALUES (45,'alpha','SO-45',4,'2026-10-17')`);
      await pool.query('UPDATE ims_credit_notes SET so_id = 45');
    }
    const lease = await claim(['refund:8001']);
    const before = await facts();
    if (conflict !== 'none') {
      await expect(applyCoordinatedShopifyRefund(lease, refund, pool)).rejects.toThrow('changed credit note');
      expect(await facts()).toEqual(before);
    } else {
      await applyCoordinatedShopifyRefund(lease, refund, pool);
      expect(await facts()).toEqual({ ...before, receipts: 1 });
    }
  });

  it('locks completed CN evidence and rejects a concurrently changed amount before acknowledgment', async () => {
    await prepareRefundOrder();
    await persistExistingRefund();
    const lease = await claim(['refund:8001']);
    const before = await facts();
    const editor = await pool.getConnection();
    let committed = false;
    try {
      await editor.beginTransaction();
      await editor.query('UPDATE ims_credit_notes SET total_amount = 21');
      const outcome = applyCoordinatedShopifyRefund(lease, refund, pool).then(
        () => 'unexpectedly acknowledged',
        (error: unknown) => error,
      );
      await vi.waitFor(async () => {
        const [processes] = await pool.query<RowDataPacket[]>('SHOW FULL PROCESSLIST');
        expect(processes.some(row => typeof row.Info === 'string'
          && row.Info.includes('SELECT id, total_amount, tax_amount FROM ims_credit_notes')
          && row.Info.includes('FOR UPDATE'))).toBe(true);
      }, { timeout: 5_000, interval: 20 });
      await editor.commit();
      committed = true;
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain('changed credit note');
      expect(await facts()).toEqual(before);
    } finally {
      if (!committed) await editor.rollback();
      editor.release();
    }
  });
});
