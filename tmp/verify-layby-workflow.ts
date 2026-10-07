import 'dotenv/config';
import assert from 'node:assert/strict';
import { query } from '../src/services/MySQLService';
import { getIMSPool } from '../src/services/IMSMySQLService';
import { runImsForBusiness } from '../src/lib/db/BusinessRegistry';
import { applyCompletedPosSaleStock, PosEodRepo, PosReportsRepo, PosSalesRepo } from '../src/lib/db/PosRepository';
import { LaybyRepository } from '../src/lib/pos/laybyRepository';

async function main() {
  const businesses = await query<any>("SELECT business_id, ims_db_name FROM businesses WHERE ims_db_name = 'readyedu_MonsterthreadsSandboxIMS' AND deleted_at IS NULL");
  assert.equal(businesses.length, 1, 'Exactly one registered sandbox is required');
  const businessId = businesses[0].business_id;
  await runImsForBusiness(businessId, async () => {
    const pool = getIMSPool();
    const connection = await pool.getConnection();
    const originalGetConnection = pool.getConnection;
    const originalExecute = pool.execute;
    const originalQuery = pool.query;
    await connection.beginTransaction();
    const transaction = Object.create(connection);
    transaction.execute = connection.execute.bind(connection);
    transaction.query = connection.query.bind(connection);
    transaction.beginTransaction = () => connection.query('SAVEPOINT layby_probe_action');
    transaction.commit = () => connection.query('RELEASE SAVEPOINT layby_probe_action');
    transaction.rollback = () => connection.query('ROLLBACK TO SAVEPOINT layby_probe_action');
    transaction.release = () => {};
    pool.getConnection = async () => transaction;
    pool.execute = connection.execute.bind(connection) as any;
    pool.query = connection.query.bind(connection) as any;
    try {
      const [locations]: any = await connection.execute('SELECT id FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [businessId]);
      const locationId = locations[0]?.id;
      assert.ok(locationId, 'An active sandbox branch is required');
      const [customers]: any = await connection.execute('SELECT id FROM ims_contacts WHERE business_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [businessId]);
      assert.ok(customers[0]?.id, 'An active sandbox contact is required');
      const [variants]: any = await connection.execute(`SELECT variant.variant_id, stock.qty_on_hand, stock.qty_committed
        FROM ims_product_variants variant JOIN ims_products product ON product.product_id = variant.product_id
        JOIN ims_stock stock ON stock.variant_id = variant.variant_id AND stock.location_id = ?
        WHERE product.business_id = ? AND product.is_stock_item = 1 AND stock.qty_on_hand - stock.qty_committed >= 3
        ORDER BY stock.qty_on_hand DESC LIMIT 1`, [locationId, businessId]);
      assert.ok(variants[0], 'Sandbox merchandise with three available units is required');
      const variant = variants[0];
      const [register]: any = await connection.execute('INSERT INTO pos_registers (location_id, name, default_float) VALUES (?, ?, 0)', [locationId, 'Rollback-only layby probe']);
      const registerId = register.insertId;
      const [first]: any = await connection.execute("INSERT INTO pos_register_sessions (register_id, location_id, session_date, opened_at, status) VALUES (?, ?, CURDATE(), NOW(), 'open')", [registerId, locationId]);
      const actor = { businessId, locationId, registerId, registerSessionId: first.insertId, cashierId: null };
      const items = [{ variant_id: variant.variant_id, code: null, name: 'Rollback-only layby merchandise', qty: 1, unit_price: 2.2, original_price: 2.2, discount_type: 'none' as const, discount_value: 0, discount_amount: 0, tax_rate: 10, line_total: 2.2 }];
      const opening = (amount: number, collect = false) => PosSalesRepo.complete({ business_id: businessId, local_id: `layby-probe-${crypto.randomUUID()}`, location_id: locationId, register_id: registerId, register_session_id: actor.registerSessionId, cashier_id: null, cashier_name: 'Rollback-only probe', sale_type: 'layby', status: 'layby_active', customer_id: customers[0].id, subtotal: 2.2, total: 2.2, tax_total: .2, discount_total: 0, collect_layby: collect, items, payments: [{ payment_method: 'Card', amount }] });
      const stock = async () => {
        const [rows]: any = await connection.execute('SELECT qty_on_hand, qty_committed FROM ims_stock WHERE variant_id = ? AND location_id = ?', [variant.variant_id, locationId]);
        return { onHand: Number(rows[0].qty_on_hand), committed: Number(rows[0].qty_committed) };
      };
      const baseline = await stock();
      const initial = await opening(.5);
      assert.deepEqual(await stock(), { onHand: baseline.onHand, committed: baseline.committed + 1 });
      assert.equal((await PosEodRepo.getExpectedBySession(first.insertId)).Card, .5);
      await connection.execute("UPDATE pos_register_sessions SET status = 'closed' WHERE id = ?", [first.insertId]);
      const [second]: any = await connection.execute("INSERT INTO pos_register_sessions (register_id, location_id, session_date, opened_at, status) VALUES (?, ?, CURDATE(), NOW(), 'open')", [registerId, locationId]);
      actor.registerSessionId = second.insertId;
      const action = (saleId: number, operationKey: string, action: 'payment' | 'collect' | 'cancel', payments: any[] = [], collect = false, feeOverride?: number) => LaybyRepository.act({ actor, saleId, operationKey, action, payments, collect, feeOverride, reason: feeOverride == null ? undefined : 'Rollback-only fee override', collectStock: applyCompletedPosSaleStock });
      await action(initial.saleId, 'probe-instalment', 'payment', [{ payment_method: 'Card', amount: .7 }]);
      await action(initial.saleId, 'probe-instalment', 'payment', [{ payment_method: 'Card', amount: .7 }]);
      await action(initial.saleId, 'probe-final-payment', 'payment', [{ payment_method: 'Card', amount: 1 }]);
      assert.equal((await PosEodRepo.getExpectedBySession(first.insertId)).Card, .5);
      assert.equal((await PosEodRepo.getExpectedBySession(second.insertId)).Card, 1.7);
      assert.deepEqual(await stock(), { onHand: baseline.onHand, committed: baseline.committed + 1 });
      await action(initial.saleId, 'probe-collection', 'collect');
      await action(initial.saleId, 'probe-collection', 'collect');
      assert.deepEqual(await stock(), { onHand: baseline.onHand - 1, committed: baseline.committed });
      const cancellation = await opening(.5);
      await action(cancellation.saleId, 'probe-cancellation', 'cancel', [{ payment_method: 'Card', amount: -.3 }], false, .2);
      assert.deepEqual(await stock(), { onHand: baseline.onHand - 1, committed: baseline.committed });
      const paidOpening = await opening(2.2, true);
      assert.equal((await PosSalesRepo.get(paidOpening.saleId))?.sale.status, 'layby_complete');
      assert.deepEqual(await stock(), { onHand: baseline.onHand - 2, committed: baseline.committed });
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
      const report = await PosReportsRepo.dailyTransactions(locationId, date);
      assert.equal(Number(report.find(transaction => transaction.sale.id === initial.saleId)?.sale.daily_revenue), 2.2);
      assert.equal(Number(report.find(transaction => transaction.sale.id === cancellation.saleId)?.sale.daily_revenue), .2);
      console.log('PASS: actual sandbox reservation, two-session instalments, idempotent retry, final GST, collect-later, collection, cancellation/refund/fee, fully paid opening and daily revenue.');
    } finally {
      pool.getConnection = originalGetConnection;
      pool.execute = originalExecute;
      pool.query = originalQuery;
      await connection.rollback();
      connection.release();
      console.log('Sandbox probe rolled back; no fixture payments, reservations, stock movements or external provider transactions retained.');
    }
  });
}
main().then(() => process.exit(0), failure => { console.error(failure.message); process.exit(1); });