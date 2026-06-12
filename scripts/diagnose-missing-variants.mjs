import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });
import mysql from 'mysql2/promise';

const BID = process.argv[2] || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const db = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

// 1. Columns on products cache table
const [cols] = await db.execute('DESCRIBE products');
console.log('\nproducts table columns:');
for (const c of cols) console.log(`  ${c.Field.padEnd(22)} ${String(c.Type).padEnd(20)} NULL=${c.Null}`);

// 2. Which non-zero option_ids in sales are completely absent from the products cache?
const [missingFromProducts] = await db.execute(
  `SELECT DISTINCT s.product_option_id, s.code, s.name
   FROM sales s
   WHERE s.business_id = ?
     AND s.product_option_id > 0
     AND NOT EXISTS (
       SELECT 1 FROM products p WHERE p.option_id = s.product_option_id AND p.business_id = ?
     )
   ORDER BY s.product_option_id`,
  [BID, BID]
);
console.log(`\nNon-zero option_ids in sales but ABSENT from products cache: ${missingFromProducts.length}`);
if (missingFromProducts.length > 0) {
  console.log('(These are truly deleted/purged from Cin7):');
  for (const r of missingFromProducts.slice(0, 20)) {
    console.log(`  option_id=${r.product_option_id}  code="${r.code}"  name="${r.name}"`);
  }
  if (missingFromProducts.length > 20) console.log(`  ... and ${missingFromProducts.length - 20} more`);
}

// 3. Which non-zero option_ids in sales DO exist in products cache? (meaning import missed them)
const [presentInProducts] = await db.execute(
  `SELECT DISTINCT s.product_option_id, p.code, p.name
   FROM sales s
   JOIN products p ON p.option_id = s.product_option_id AND p.business_id = s.business_id
   WHERE s.business_id = ?
     AND s.product_option_id > 0
   ORDER BY s.product_option_id`,
  [BID]
);

// Cross-reference with IMS variants
const ims = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const [imsVars] = await ims.execute(
  'SELECT cin7_option_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL'
);
const imsSet = new Set(imsVars.map(v => v.cin7_option_id));

const importMissed = presentInProducts.filter(r => !imsSet.has(r.product_option_id));
console.log(`\nOption_ids in products cache but NOT imported to IMS: ${importMissed.length}`);
if (importMissed.length > 0) {
  console.log('(These could be re-imported):');
  for (const r of importMissed.slice(0, 20)) {
    console.log(`  option_id=${r.product_option_id}  code="${r.code}"  name="${r.name}"`);
  }
  if (importMissed.length > 20) console.log(`  ... and ${importMissed.length - 20} more`);
}

// 4. option_id=0 counts
const [[zeroRow]] = await db.execute(
  `SELECT COUNT(DISTINCT order_id) AS orders, COUNT(*) AS line_count,
          GROUP_CONCAT(DISTINCT name ORDER BY name SEPARATOR ' | ') AS names
   FROM sales WHERE business_id = ? AND (product_option_id = 0 OR product_option_id IS NULL)`,
  [BID]
);
console.log(`\noption_id=0 (non-inventory items): ${zeroRow.orders} orders, ${zeroRow.line_count} lines`);
console.log('  Item types:', zeroRow.names?.slice(0, 200));

await db.end(); await ims.end();
console.log('\nDone.');
