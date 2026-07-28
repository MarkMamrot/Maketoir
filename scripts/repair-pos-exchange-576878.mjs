#!/usr/bin/env node

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const schema = 'readyedu_MonsterthreadsIMS';
const saleId = 576878;
const creditNoteId = 5;
const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const exchangeDate = '2026-07-28';
const apply = process.argv.includes('--apply');

function assert(condition, message) {
  if (!condition) throw new Error(`Preflight failed: ${message}`);
}

const connection = await mysql.createConnection({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port: Number(process.env.IMS_MYSQL_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.IMS_MYSQL_USER || process.env.MYSQL_USER,
  password: process.env.IMS_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD,
  database: schema,
});
const mainConnection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [[sale]] = await connection.execute(
    'SELECT * FROM pos_sales WHERE id = ?',
    [saleId],
  );
  const [saleItems] = await connection.execute(
    'SELECT * FROM pos_sale_items WHERE sale_id = ? ORDER BY id',
    [saleId],
  );
  const [payments] = await connection.execute(
    'SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY id',
    [saleId],
  );
  const [[creditNote]] = await connection.execute(
    'SELECT * FROM ims_credit_notes WHERE id = ?',
    [creditNoteId],
  );
  const [creditNoteItems] = await connection.execute(
    'SELECT * FROM ims_credit_note_items WHERE cn_id = ? ORDER BY id',
    [creditNoteId],
  );
  const [movements] = await connection.execute(
    `SELECT * FROM ims_stock_movements
     WHERE (reference_type = 'credit_note' AND reference_id = ?)
        OR (reference_type = 'pos_sale' AND reference_id = ?)
     ORDER BY id`,
    [creditNoteId, saleId],
  );
  const variantIds = [...new Set(saleItems.map(item => item.variant_id).filter(Boolean))];
  const placeholders = variantIds.map(() => '?').join(',');
  const [stock] = variantIds.length
    ? await connection.execute(
        `SELECT s.variant_id, v.sku, s.location_id, s.qty_on_hand, v.avg_cost
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         WHERE s.variant_id IN (${placeholders}) AND s.location_id = ?
         ORDER BY v.sku`,
        [...variantIds, sale.location_id],
      )
    : [[]];
  const [storeCredit] = creditNote?.customer_id
    ? await connection.execute(
        `SELECT * FROM store_credit_transactions
         WHERE contact_id = ? AND (pos_sale_id = ? OR credit_note_id = ?)
         ORDER BY id`,
        [creditNote.customer_id, saleId, creditNoteId],
      )
    : [[]];
  const [cogsRuns] = await mainConnection.execute(
    `SELECT * FROM xero_cogs_journal_runs
     WHERE business_id = ? AND period_start <= ? AND period_end >= ?
     ORDER BY id`,
    [businessId, exchangeDate, exchangeDate],
  );

  if (apply) {
    assert(sale?.business_id === businessId, 'unexpected POS sale tenant');
    assert(sale?.credit_note_id === creditNoteId, 'POS sale is not linked to CN 5');
    assert(sale?.sale_type === 'return' && sale?.status === 'completed', 'unexpected POS sale state');
    assert(Number(sale.total) === 3, 'POS sale total is no longer $3.00');
    assert(creditNote?.source === 'pos' && creditNote?.status === 'complete', 'unexpected credit-note state');
    assert(creditNote?.settlement_method === 'refund' && creditNote?.settlement_status === 'complete', 'unexpected settlement state');
    assert(creditNote?.xero_credit_note_id == null, 'standalone Xero credit note exists');
    assert(storeCredit.length === 0, 'store-credit settlement exists');
    assert(cogsRuns.length === 0, 'a COGS journal already covers the exchange date');
    assert(saleItems.length === 3 && creditNoteItems.length === 3, 'unexpected item count');
    assert(
      saleItems.map(item => `${item.id}:${item.code}:${Number(item.qty)}`).join('|')
        === '972869:UP172255:-2|972870:UG196061:1|972871:UG136352:1',
      'POS items no longer match the audited exchange',
    );
    assert(
      creditNoteItems.map(item => `${item.id}:${item.code}:${Number(item.qty)}:${Number(item.tax_rate)}`).join('|')
        === '4:UP172255:2:10|5:UG196061:1:10|6:UG136352:1:10',
      'credit-note items no longer match the malformed rows',
    );
    assert(
      movements.map(row => `${row.id}:${row.movement_type}:${row.code ?? ''}:${Number(row.qty_change)}`).length === 3
        && movements.map(row => row.id).join(',') === '12791,12792,12793',
      'related stock movements no longer match the audited rows',
    );

    const stockByVariant = new Map(stock.map(row => [row.variant_id, row]));
    const replacementItems = saleItems.filter(item => Number(item.qty) > 0);
    for (const item of replacementItems) {
      const row = stockByVariant.get(item.variant_id);
      assert(row, `stock row missing for ${item.code}`);
      const [[laterMovement]] = await connection.execute(
        `SELECT id FROM ims_stock_movements
         WHERE variant_id = ? AND location_id = ? AND id > ?
         ORDER BY id LIMIT 1`,
        [item.variant_id, sale.location_id, item.code === 'UG196061' ? 12792 : 12793],
      );
      assert(!laterMovement, `later stock movement exists for ${item.code}`);
    }

    await connection.beginTransaction();
    try {
      await connection.execute(
        `UPDATE ims_credit_note_items
         SET tax_rate = 0.1
         WHERE id = 4 AND cn_id = ? AND code = 'UP172255'`,
        [creditNoteId],
      );
      await connection.execute(
        'DELETE FROM ims_credit_note_items WHERE cn_id = ? AND id IN (5, 6)',
        [creditNoteId],
      );
      await connection.execute(
        `UPDATE ims_credit_notes
         SET reference = 'POS Exchange #576878', subtotal = 25.36,
             tax_amount = 2.54, total_amount = 27.90
         WHERE id = ?`,
        [creditNoteId],
      );
      await connection.execute(
        `UPDATE ims_stock_movements
         SET unit_cost = 5.30,
             notes = 'Return line retained by audited POS exchange repair'
         WHERE id = 12791 AND reference_type = 'credit_note' AND reference_id = ?`,
        [creditNoteId],
      );

      for (const item of replacementItems) {
        const row = stockByVariant.get(item.variant_id);
        const newSoh = Number(row.qty_on_hand) - Number(item.qty);
        await connection.execute(
          `UPDATE ims_stock SET qty_on_hand = ?
           WHERE variant_id = ? AND location_id = ? AND qty_on_hand = ?`,
          [newSoh, item.variant_id, sale.location_id, row.qty_on_hand],
        );
        await connection.execute(
          `INSERT INTO ims_stock_movements
             (business_id, variant_id, location_id, movement_type, channel,
              reference_type, reference_id, qty_change, qty_after_soh, unit_cost,
              notes, created_at)
           VALUES (?, ?, ?, 'pos_sale', 'pos', 'pos_sale', ?, ?, ?, ?, ?, ?)`,
          [
            businessId,
            item.variant_id,
            sale.location_id,
            saleId,
            -Number(item.qty),
            newSoh,
            Number(row.avg_cost),
            'Historical correction: replacement line omitted from mixed POS exchange stock handling',
            sale.completed_at,
          ],
        );
      }
      await connection.commit();
      console.log('\nRepair committed successfully. Re-run without --apply to verify final state.');
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  console.log(`Target: ${schema}, POS sale ${saleId}, credit note ${creditNoteId}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (read-only)'}`);
  console.log('\nPOS sale');
  console.table(sale ? [sale] : []);
  console.log('\nPOS items');
  console.table(saleItems);
  console.log('\nPayments');
  console.table(payments);
  console.log('\nCredit note');
  console.table(creditNote ? [creditNote] : []);
  console.log('\nCredit note items');
  console.table(creditNoteItems);
  console.log('\nRelated stock movements');
  console.table(movements);
  console.log('\nCurrent stock');
  console.table(stock);
  console.log('\nStore-credit settlement');
  console.table(storeCredit);
  console.log('\nCOGS journal runs covering the exchange date');
  console.table(cogsRuns);
} finally {
  await connection.end();
  await mainConnection.end();
}