/**
 * Repair PO-2026-0001 (id 4837) double-receive.
 *
 * The PO was received TWICE (two identical `po_received` movement sets), so
 * qty_on_hand at location 4 is doubled. This removes the LATER duplicate set
 * and subtracts its quantities from ims_stock, restoring a single receive.
 *
 * Safety: verifies the duplicate set is exactly one full receive matching the
 * PO's ordered total before committing. Runs in a transaction. Re-queues the
 * affected variants so Shopify gets the corrected numbers.
 *
 * Usage:
 *   node scripts/fix-po-2026-0001-double-receive.mjs          (dry run)
 *   node scripts/fix-po-2026-0001-double-receive.mjs --apply   (commit)
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const APPLY = process.argv.includes('--apply');
const PO_ID = 4837;

const ims = await createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

try {
  await ims.beginTransaction();

  // Ordered total (the correct single-receive quantity for this PO).
  const [[ord]] = await ims.execute(
    `SELECT COALESCE(SUM(qty_ordered),0) AS total, COUNT(*) AS n
       FROM ims_purchase_order_items WHERE po_id = ?`, [PO_ID]);
  const orderedTotal = Number(ord.total);
  const itemCount = Number(ord.n);

  // The duplicate = the LATEST po_received set (all rows share the max timestamp).
  const [[mx]] = await ims.execute(
    `SELECT MAX(created_at) AS ts FROM ims_stock_movements
      WHERE reference_type='purchase_order' AND reference_id=? AND movement_type='po_received'`, [PO_ID]);
  if (!mx.ts) throw new Error('No po_received movements found — nothing to fix.');

  const [dupRows] = await ims.execute(
    `SELECT id, variant_id, location_id, qty_change
       FROM ims_stock_movements
      WHERE reference_type='purchase_order' AND reference_id=? AND movement_type='po_received'
        AND created_at = ?`, [PO_ID, mx.ts]);

  const dupTotal = dupRows.reduce((s, r) => s + Number(r.qty_change), 0);

  // How many distinct receive sets exist? Must be exactly 2 to safely remove 1.
  const [setRows] = await ims.execute(
    `SELECT created_at, COUNT(*) n, SUM(qty_change) total
       FROM ims_stock_movements
      WHERE reference_type='purchase_order' AND reference_id=? AND movement_type='po_received'
      GROUP BY created_at ORDER BY created_at`, [PO_ID]);

  console.log('PO ordered total:', orderedTotal, 'across', itemCount, 'items');
  console.log('Duplicate (latest) set:', dupRows.length, 'rows, total', dupTotal, '@', mx.ts);
  console.log('All po_received sets:'); console.table(setRows);

  // ── Safety assertions ──────────────────────────────────────────────
  if (dupRows.length !== itemCount)
    throw new Error(`Refusing: duplicate set has ${dupRows.length} rows, expected ${itemCount}.`);
  if (Math.abs(dupTotal - orderedTotal) > 0.001)
    throw new Error(`Refusing: duplicate total ${dupTotal} != ordered total ${orderedTotal}.`);
  // Sum of ALL po_received must equal ~2x ordered (i.e. exactly a double receive).
  const grandTotal = setRows.reduce((s, r) => s + Number(r.total), 0);
  if (Math.abs(grandTotal - 2 * orderedTotal) > 0.001)
    throw new Error(`Refusing: total received ${grandTotal} != 2x ordered ${2 * orderedTotal}. Not a clean double.`);

  // Before snapshot
  const variantIds = [...new Set(dupRows.map(r => r.variant_id))];
  const ph = variantIds.map(() => '?').join(',');
  const [before] = await ims.execute(
    `SELECT variant_id, location_id, qty_on_hand FROM ims_stock
      WHERE variant_id IN (${ph}) AND location_id = ? ORDER BY variant_id`,
    [...variantIds, dupRows[0].location_id]);
  console.log('\nBEFORE (location', dupRows[0].location_id, '):'); console.table(before);

  // ── Apply: subtract duplicate qty, delete duplicate movements ──────
  for (const r of dupRows) {
    await ims.execute(
      `UPDATE ims_stock SET qty_on_hand = qty_on_hand - ?
        WHERE variant_id = ? AND location_id = ?`,
      [Number(r.qty_change), r.variant_id, r.location_id]);
  }
  const dupIds = dupRows.map(r => r.id);
  await ims.execute(
    `DELETE FROM ims_stock_movements WHERE id IN (${dupIds.map(() => '?').join(',')})`, dupIds);

  // Re-queue affected variants so Shopify receives the corrected numbers.
  await ims.execute(
    `INSERT IGNORE INTO ims_shopify_inventory_queue (variant_id, queued_at)
     VALUES ${variantIds.map(() => '(?, NOW())').join(',')}`, variantIds).catch(() => {});

  const [after] = await ims.execute(
    `SELECT variant_id, location_id, qty_on_hand FROM ims_stock
      WHERE variant_id IN (${ph}) AND location_id = ? ORDER BY variant_id`,
    [...variantIds, dupRows[0].location_id]);
  console.log('\nAFTER:'); console.table(after);

  if (APPLY) {
    await ims.commit();
    console.log(`\n✅ APPLIED: removed ${dupIds.length} duplicate movements, subtracted ${dupTotal} units, re-queued ${variantIds.length} variants for Shopify.`);
  } else {
    await ims.rollback();
    console.log('\n🔎 DRY RUN — rolled back. Re-run with --apply to commit.');
  }
} catch (e) {
  await ims.rollback();
  console.error('\n❌ ABORTED:', e.message);
} finally {
  await ims.end();
}
