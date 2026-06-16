/**
 * diagnose-missing-stock.mjs
 * Finds why certain SKUs from the Cin7 CSV have no IMS stock record for Newtown.
 * Looks them up by product name / barcode when SKU doesn't match.
 */
import 'dotenv/config';
import fs from 'fs';
import mysql from 'mysql2/promise';

const IMS_LOCATION_ID = 1;

const MISSING_SKUS = [
  'HB5196W26','HB1219W26','HB5194W26',
  'islatop1-kids','islatop2-kids',
  'HB1050S25','SS25-3G','SS25-3A','SS25-6A','SS25-6E',
  'SRS-HEJ','SRS-SPA','SBT-SPA','SBT-BIL','LG334- FLORET',
  'LBH-HEJ','HE-PB347- DAISY',
  '7.34007E+12',
];

// Also grab product names from the CSV so we can search by name
const CSV_PATH = 'C:\\Users\\mark\\Downloads\\newtowncin7SOH.csv';
const csvText = fs.readFileSync(CSV_PATH, 'utf8');
const csvLines = csvText.replace(/\r/g, '').split('\n');
const csvHeader = csvLines[0].split(',');
const codeIdx = csvHeader.indexOf('Code');
const nameIdx = csvHeader.indexOf('Name');
const barcodeIdx = csvHeader.indexOf('Barcode') ?? -1;

const skuNameMap = new Map();
for (let i = 1; i < csvLines.length; i++) {
  if (!csvLines[i].trim()) continue;
  const cols = csvLines[i].split(',');
  const sku = cols[codeIdx]?.trim();
  const name = cols[nameIdx]?.trim().replace(/^"|"$/g, '');
  if (sku) skuNameMap.set(sku, name ?? '');
}

const db = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

console.log('\n══════════════════════════════════════════════════════════');
console.log(' Diagnosing Missing IMS Stock for Newtown (location_id=1)');
console.log('══════════════════════════════════════════════════════════\n');

for (const sku of MISSING_SKUS) {
  const cin7Name = skuNameMap.get(sku) ?? '';
  console.log(`\n── ${sku} ${cin7Name ? `("${cin7Name}")` : ''} ──`);

  // 1. Direct SKU match in variants
  const [bySkuV] = await db.execute(
    `SELECT v.variant_id, v.sku, v.barcode, v.cin7_option_id, v.is_active,
            v.option1_value, v.option2_value, v.option3_value,
            p.name AS product_name, p.is_active AS prod_active
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     WHERE v.sku = ?`,
    [sku],
  );

  if (bySkuV.length > 0) {
    console.log(`  FOUND by SKU (${bySkuV.length} variant(s)):`);
    for (const v of bySkuV) {
      // Check stock
      const [st] = await db.execute(
        `SELECT location_id, qty_on_hand, l.name AS loc
         FROM ims_stock s JOIN ims_locations l ON l.id=s.location_id
         WHERE s.variant_id=?`,
        [v.variant_id],
      );
      const newtownStock = st.find(s => s.location_id === IMS_LOCATION_ID);
      const stockSummary = st.length === 0
        ? 'NO STOCK ROWS AT ALL'
        : st.map(s => `${s.loc}:${s.qty_on_hand}`).join(', ');
      console.log(`    variant_id=${v.variant_id} sku=${v.sku} barcode=${v.barcode ?? 'null'}`);
      console.log(`    opts: "${v.option1_value ?? ''}" / "${v.option2_value ?? ''}" / "${v.option3_value ?? ''}"`);
      console.log(`    prod_active=${v.prod_active} variant_active=${v.is_active}`);
      console.log(`    stock: ${stockSummary}`);
      if (!newtownStock) console.log(`    ⚠ NO stock row for Newtown (location_id=${IMS_LOCATION_ID})`);
    }
    continue;
  }

  // 2. Barcode match (handle scientific notation like 7.34007E+12)
  let barcodeSearch = sku;
  if (/\d\.\d+E\+\d+/i.test(sku)) {
    try { barcodeSearch = String(BigInt(Math.round(Number(sku)))); } catch {}
  }
  const [byBarcodeV] = await db.execute(
    `SELECT v.variant_id, v.sku, v.barcode, v.cin7_option_id, v.is_active,
            p.name AS product_name, p.is_active AS prod_active
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     WHERE v.barcode = ?`,
    [barcodeSearch],
  );
  if (byBarcodeV.length > 0) {
    console.log(`  FOUND by barcode "${barcodeSearch}" (${byBarcodeV.length} variant(s)):`);
    for (const v of byBarcodeV) {
      const [st] = await db.execute(
        `SELECT location_id, qty_on_hand, l.name AS loc
         FROM ims_stock s JOIN ims_locations l ON l.id=s.location_id
         WHERE s.variant_id=?`,
        [v.variant_id],
      );
      console.log(`    variant_id=${v.variant_id} sku=${v.sku} barcode=${v.barcode}`);
      console.log(`    prod: "${v.product_name}" active=${v.prod_active}/${v.is_active}`);
      console.log(`    stock: ${st.length === 0 ? 'NONE' : st.map(s=>`${s.loc}:${s.qty_on_hand}`).join(', ')}`);
    }
    continue;
  }

  // 3. Product name match (partial, case-insensitive)
  if (cin7Name) {
    const namePart = cin7Name.slice(0, 30); // first 30 chars
    const [byNameP] = await db.execute(
      `SELECT DISTINCT p.product_id, p.name, p.is_active,
              COUNT(v.variant_id) AS var_count
       FROM ims_products p
       LEFT JOIN ims_product_variants v ON v.product_id = p.product_id
       WHERE p.name LIKE ?
       GROUP BY p.product_id`,
      [`%${namePart}%`],
    );
    if (byNameP.length > 0) {
      console.log(`  FOUND by name search "${namePart}" (${byNameP.length} product(s)):`);
      for (const p of byNameP) {
        // Get variants and their skus
        const [varRows] = await db.execute(
          `SELECT v.variant_id, v.sku, v.barcode, v.is_active, v.option1_value,
                  s.qty_on_hand, s.location_id
           FROM ims_product_variants v
           LEFT JOIN ims_stock s ON s.variant_id=v.variant_id AND s.location_id=?
           WHERE v.product_id=?`,
          [IMS_LOCATION_ID, p.product_id],
        );
        console.log(`    Product: "${p.name}" (active=${p.is_active}, ${p.var_count} variants)`);
        for (const v of varRows) {
          console.log(`      sku=${v.sku ?? 'NULL'} barcode=${v.barcode ?? 'null'} opt=${v.option1_value ?? ''} newtown_soh=${v.qty_on_hand ?? 'NO ROW'} active=${v.is_active}`);
        }
      }
      continue;
    }
  }

  console.log(`  ✗ NOT FOUND by SKU, barcode, or name — not imported at all`);
}

await db.end();
console.log('\n══════════════════════════════════════════════════════════\n');
