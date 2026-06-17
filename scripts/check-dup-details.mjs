import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// Get all details on duplicate variants
const [dups] = await db.execute(`
  SELECT v.sku, GROUP_CONCAT(DISTINCT v.barcode) AS barcodes,
         GROUP_CONCAT(DISTINCT v.variant_id) AS variant_ids,
         GROUP_CONCAT(DISTINCT v.cin7_option_id) AS option_ids,
         COUNT(*) AS cnt
  FROM ims_product_variants v
  WHERE v.sku IS NOT NULL AND v.sku != ''
  GROUP BY v.sku
  HAVING COUNT(*) > 1
  LIMIT 5
`);

for (const d of dups) {
  console.log(`SKU: ${d.sku}`);
  console.log(`  barcodes: ${d.barcodes}`);
  console.log(`  variant_ids: ${d.variant_ids}`);

  // Show full details for each
  const [variants] = await db.execute(
    `SELECT v.variant_id, v.sku, v.barcode, v.cin7_option_id, v.created_at,
            p.cin7_product_id
     FROM ims_product_variants v JOIN ims_products p ON p.product_id=v.product_id
     WHERE v.sku=? ORDER BY v.created_at`, [d.sku]
  );
  variants.forEach(v => console.log(`  id=${v.variant_id} barcode=${v.barcode} cin7opt=${v.cin7_option_id} cin7prod=${v.cin7_product_id} created=${v.created_at}`));
}

// How many total duplicate variant rows?
const [[total]] = await db.execute(`
  SELECT COUNT(*) AS total_variants,
         SUM(cnt) AS extra_variants
  FROM (
    SELECT sku, COUNT(*) AS cnt FROM ims_product_variants
    WHERE sku IS NOT NULL AND sku != '' GROUP BY sku HAVING COUNT(*) > 1
  ) t
`);
console.log(`\nTotal SKUs with dups: unknown | Extra variant rows: ${Number(total.extra_variants) - Number(total.total_variants) || 'calc needed'}`);

const [allDups] = await db.execute(`
  SELECT COUNT(*) c FROM (
    SELECT sku FROM ims_product_variants WHERE sku IS NOT NULL AND sku != ''
    GROUP BY sku HAVING COUNT(*) > 1
  ) t`);
console.log(`Total dup-SKU groups: ${allDups[0].c}`);

// Total extra stock from duplicate variants
const [[stockDup]] = await db.execute(`
  SELECT SUM(s.qty_on_hand) AS extra_soh
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1
    AND v.sku IN (
      SELECT sku FROM ims_product_variants WHERE sku IS NOT NULL
      GROUP BY sku HAVING COUNT(*) > 1
    )
`);
console.log(`All-dup-variant SOH at Newtown: ${Number(stockDup.extra_soh)}`);

await db.end();
