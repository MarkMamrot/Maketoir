import 'dotenv/config';
import mysql from 'mysql2/promise';

const codes = [
  'HB5196W26','HB1219W26','HB5194W26','islatop1-kids','islatop2-kids',
  'HB1050S25','HB1312S25','HB1055S25','SS25-3G','SS25-3A','SS25-6A','SS25-6E',
  'SRS-HEJ','SRS-SPA','SBT-SPA','SBT-BIL','LG334- FLORET','LBH-HEJ','SW-LG257-RAINBOW','HE-PB347- DAISY','7.34007E+12'
];

const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

for (const code of codes) {
  const [exact] = await db.execute(
    `SELECT v.sku, p.name, s.qty_on_hand
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id=v.product_id
     LEFT JOIN ims_stock s ON s.variant_id=v.variant_id AND s.location_id=1
     WHERE v.sku = ?`,
    [code],
  );

  // Prefix fallback for size-grid / parent code representation
  const [pref] = await db.execute(
    `SELECT v.sku, p.name, COALESCE(s.qty_on_hand,0) AS qty_on_hand
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id=v.product_id
     LEFT JOIN ims_stock s ON s.variant_id=v.variant_id AND s.location_id=1
     WHERE v.sku LIKE ?
     ORDER BY v.sku`,
    [`${code}-%`],
  );

  const prefTotal = pref.reduce((a, r) => a + Number(r.qty_on_hand || 0), 0);

  console.log(`\n${code}`);
  console.log(`  exact matches: ${exact.length}`);
  if (exact.length) {
    for (const r of exact) console.log(`    ${r.sku} | soh=${r.qty_on_hand ?? 'NO ROW'} | ${r.name}`);
  }
  console.log(`  prefix matches: ${pref.length} | prefix SOH total=${prefTotal}`);
  if (pref.length) {
    for (const r of pref) console.log(`    ${r.sku} | soh=${r.qty_on_hand} | ${r.name}`);
  }
}

await db.end();
