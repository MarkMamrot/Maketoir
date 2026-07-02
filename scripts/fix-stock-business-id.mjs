/**
 * Fix ims_stock rows that have business_id = NULL (created by the old stock-mins upsert
 * which didn't include business_id in the INSERT).
 *
 * Sets business_id by joining through ims_product_variants (which always has the correct
 * business_id from product creation).
 *
 * Usage: node scripts/fix-stock-business-id.mjs
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

try {
  // 1. Count affected rows
  const [[{ cnt }]] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM ims_stock WHERE business_id IS NULL OR business_id = ''`
  );
  console.log(`Found ${cnt} ims_stock row(s) with missing business_id.`);

  if (Number(cnt) === 0) {
    console.log('Nothing to fix — all rows already have business_id set.');
    process.exit(0);
  }

  // 2. Show a preview of affected rows
  const [preview] = await conn.execute(
    `SELECT s.id, s.variant_id, s.location_id, s.qty_on_hand, s.min_qty, s.reorder_qty,
            v.sku, v.business_id AS variant_biz_id
     FROM ims_stock s
     JOIN ims_product_variants v ON v.variant_id = s.variant_id
     WHERE s.business_id IS NULL OR s.business_id = ''
     LIMIT 20`
  );
  console.log('\nPreview of rows to fix (up to 20):');
  console.table(preview);

  // 3. Apply the fix: set business_id from ims_product_variants
  const [result] = await conn.execute(
    `UPDATE ims_stock s
     JOIN ims_product_variants v ON v.variant_id = s.variant_id
     SET s.business_id = v.business_id
     WHERE (s.business_id IS NULL OR s.business_id = '')
       AND v.business_id IS NOT NULL
       AND v.business_id != ''`
  );
  console.log(`\nFixed ${result.affectedRows} row(s).`);

  // 4. Confirm any remaining unfixed rows (variants with no business_id themselves)
  const [[{ remaining }]] = await conn.execute(
    `SELECT COUNT(*) AS remaining FROM ims_stock WHERE business_id IS NULL OR business_id = ''`
  );
  if (Number(remaining) > 0) {
    console.warn(`\n⚠  ${remaining} row(s) still have no business_id — their variant may also be missing a business_id.`);
  } else {
    console.log('\n✓ All ims_stock rows now have a business_id.');
  }

} finally {
  await conn.end();
}
