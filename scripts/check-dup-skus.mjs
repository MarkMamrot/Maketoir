import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// Find SKUs with multiple variants that have stock at Newtown (location_id=1)
const [dups] = await db.execute(`
  SELECT v.sku, COUNT(*) AS variant_count, SUM(s.qty_on_hand) AS total_soh
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id = s.variant_id
  WHERE s.location_id = 1 AND v.sku IS NOT NULL AND v.sku != ''
  GROUP BY v.sku
  HAVING COUNT(*) > 1
  ORDER BY total_soh DESC
  LIMIT 30
`);

console.log(`SKUs with >1 variant at Newtown: ${dups.length}`);
const dupTotalSoh = dups.reduce((a, r) => a + Number(r.total_soh), 0);
console.log(`Sum of SOH for all dup-sku rows: ${dupTotalSoh}\n`);

for (const d of dups) {
  console.log(`  sku="${d.sku}" variants=${d.variant_count} soh=${Number(d.total_soh)}`);
  const [variants] = await db.execute(`
    SELECT v.variant_id, v.cin7_option_id, v.option1_value, v.option2_value,
           s.qty_on_hand, p.name AS product_name
    FROM ims_product_variants v
    JOIN ims_products p ON p.product_id = v.product_id
    LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = 1
    WHERE v.sku = ?`, [d.sku]);
  for (const v of variants) {
    console.log(`    variant_id=${v.variant_id} cin7_option_id=${v.cin7_option_id ?? 'NULL'} opt1="${v.option1_value}" soh=${v.qty_on_hand} prod="${v.product_name}"`);
  }
}

// How much SOH difference does dedup cause?
const [[allJoined]] = await db.execute(`
  SELECT COUNT(*) c, SUM(s.qty_on_hand) soh
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1`);
console.log(`\nAll joined rows: ${Number(allJoined.c)}  SOH: ${Number(allJoined.soh)}`);

// Simulate compare script dedup
const [allRows] = await db.execute(`
  SELECT v.sku, s.qty_on_hand
  FROM ims_stock s
  JOIN ims_product_variants v ON v.variant_id=s.variant_id
  WHERE s.location_id=1`);
const deduped = new Map();
for (const r of allRows) {
  if (r.sku) deduped.set(r.sku, r);
}
const dedupedTotal = Array.from(deduped.values()).reduce((a, r) => a + Number(r.qty_on_hand), 0);
console.log(`Deduped (by SKU) row count: ${deduped.size}  SOH: ${dedupedTotal}`);

await db.end();
