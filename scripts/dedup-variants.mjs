/**
 * dedup-variants.mjs
 * Removes duplicate ims_product_variants that share the same sku.
 * Keeps the EARLIEST created variant per sku, deletes the rest (and their stock rows).
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// Find duplicate groups: same sku, keep earliest created_at
const [groups] = await db.execute(`
  SELECT sku, COUNT(*) AS cnt,
         MIN(created_at) AS keep_created,
         GROUP_CONCAT(variant_id ORDER BY created_at ASC SEPARATOR ',') AS ordered_ids
  FROM ims_product_variants
  WHERE sku IS NOT NULL AND sku != ''
  GROUP BY sku
  HAVING COUNT(*) > 1
`);

console.log(`Found ${groups.length} duplicate SKU groups to clean up`);

let deleted = 0;
for (const g of groups) {
  const ids = g.ordered_ids.split(',');
  const keepId = ids[0];      // earliest = keep
  const deleteIds = ids.slice(1); // rest = delete

  // Delete their stock rows first
  const placeholders = deleteIds.map(() => '?').join(',');
  await db.execute(
    `DELETE FROM ims_stock WHERE variant_id IN (${placeholders})`,
    deleteIds,
  );

  // Delete the variant itself
  await db.execute(
    `DELETE FROM ims_product_variants WHERE variant_id IN (${placeholders})`,
    deleteIds,
  );

  deleted += deleteIds.length;
}

console.log(`Deleted ${deleted} duplicate variants (and their stock rows)`);

// Verify
const [[after]] = await db.execute(`
  SELECT COUNT(*) c, COALESCE(SUM(s.qty_on_hand),0) soh
  FROM ims_stock s WHERE s.location_id=1`);
console.log(`Newtown SOH after cleanup: ${Number(after.soh)} (${Number(after.c)} rows)`);

await db.end();
