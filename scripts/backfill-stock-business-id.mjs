/**
 * Backfill ims_stock.business_id where it is empty/NULL, deriving the value from
 * the variant's product (ims_products.business_id). These orphaned rows (created
 * by PO confirm/receive before the business_id fix) are invisible in the
 * business-scoped Stock Levels view until repaired.
 *
 *   node scripts/backfill-stock-business-id.mjs          (dry run)
 *   node scripts/backfill-stock-business-id.mjs --apply   (commit)
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const APPLY = process.argv.includes('--apply');
const ims = await createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

try {
  await ims.beginTransaction();

  const [before] = await ims.execute(
    `SELECT s.variant_id, s.location_id, s.qty_on_hand, p.business_id AS derived
       FROM ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
      WHERE (s.business_id IS NULL OR s.business_id = '')
      ORDER BY p.business_id, s.variant_id`);
  console.log(`Rows to backfill: ${before.length}`);
  console.table(before.map(r => ({ variant: r.variant_id.slice(0, 8), loc: r.location_id, soh: r.qty_on_hand, '→ business_id': r.derived })));

  // Any rows we can't derive a business_id for? (would be left as-is)
  const underivable = before.filter(r => !r.derived);
  if (underivable.length) {
    console.warn(`\n⚠️ ${underivable.length} rows have no derivable business_id (orphan variant/product) — skipped.`);
  }

  // Update in one statement via the same join.
  const [res] = await ims.execute(
    `UPDATE ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
        SET s.business_id = p.business_id
      WHERE (s.business_id IS NULL OR s.business_id = '')
        AND p.business_id IS NOT NULL AND p.business_id <> ''`);
  console.log(`\nUpdated ${res.affectedRows} rows.`);

  const [[remaining]] = await ims.execute(
    `SELECT COUNT(*) n FROM ims_stock WHERE business_id IS NULL OR business_id = ''`);
  console.log(`Remaining empty business_id rows after fix: ${remaining.n}`);

  if (APPLY) {
    await ims.commit();
    console.log('\n✅ APPLIED.');
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
