/**
 * probe-sizegrid-stock2.mjs
 * Shows what Cin7 /Stock returns for size-grid products vs IMS variant SKUs.
 * Specifically investigates why the 65-unit gap persists after sync.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

const imsDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.IMS_MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});
const mainDb = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
});

const BUSINESS_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const [connRows] = await mainDb.execute(
  `SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id=? LIMIT 1`, [BUSINESS_ID],
);
await mainDb.end();
const apiKey = decrypt(connRows[0].cin7_account_id);
const apiPass = decrypt(connRows[0].cin7_api_key);
const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiPass}`).toString('base64');

async function cin7Get(path) {
  const res = await fetch(`https://api.cin7.com/api/v1${path}`, { headers: { Authorization: authHeader } });
  return res.json();
}

// 1. Find size-grid variants in IMS (those whose sku contains a dash-separated size)
//    and also check which ones have zero stock at Newtown (location_id=1)
console.log('=== IMS size-grid variants with zero Newtown stock ===\n');
const [zeroStock] = await imsDb.execute(`
  SELECT v.variant_id, v.sku, v.barcode, v.cin7_option_id, p.name AS product_name,
         COALESCE(s.qty_on_hand, 0) AS newtown_soh
  FROM ims_product_variants v
  JOIN ims_products p ON p.product_id = v.product_id
  LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = 1
  WHERE v.sku IS NOT NULL AND v.sku REGEXP '.+-[0-9]'
    AND (s.qty_on_hand IS NULL OR s.qty_on_hand = 0)
  ORDER BY p.name, v.sku
  LIMIT 30
`);

console.log(`Found ${zeroStock.length} size-grid variants with 0 Newtown SOH (limit 30)`);

// Get a sample set of unique product-level codes (before the dash+number) to probe /Stock
const sampleCodes = new Set();
for (const r of zeroStock) {
  // e.g., "SRS-SPA-3 to 6 months" → productOptionCode might be "SRS-SPA"
  sampleCodes.add(r.sku);
  if (sampleCodes.size >= 3) break;
}

// 2. For known problem product codes from the CSV, check what /Stock actually returns
const PROBE_CODES = ['SRS-SPA', 'SRS-HEJ', 'SBT-SPA', 'SBT-BIL'];
console.log(`\n=== Probing Cin7 /Stock for codes: ${PROBE_CODES.join(', ')} ===\n`);

for (const code of PROBE_CODES) {
  console.log(`\n── code="${code}" ──`);

  // Get from /Stock (by searching with the code as "where" filter)
  const data = await cin7Get(`/Stock?rows=20&where=(code="${code}")`);
  const records = Array.isArray(data) ? data : (data.data ?? []);
  console.log(`  /Stock returned ${records.length} records`);
  if (records.length > 0) {
    console.log(`  Keys in first record: ${Object.keys(records[0]).join(', ')}`);
    for (const r of records.slice(0, 5)) {
      console.log(`  branchId=${r.branchId} branchName="${r.branchName}" code="${r.code}" size="${r.size ?? 'N/A'}" barcode="${r.barcode ?? 'N/A'}" soh=${r.stockOnHand}`);
    }
  }

  // Check IMS variants matching this code prefix
  const [imsVars] = await imsDb.execute(
    `SELECT v.variant_id, v.sku, v.barcode, COALESCE(s.qty_on_hand, 0) AS newtown_soh
     FROM ims_product_variants v
     LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = 1
     WHERE v.sku LIKE ? OR v.sku = ?
     ORDER BY v.sku`,
    [`${code}-%`, code],
  );
  console.log(`  IMS variants for "${code}" (${imsVars.length} rows):`);
  for (const v of imsVars) {
    console.log(`    sku="${v.sku}" barcode="${v.barcode ?? 'null'}" newtown_soh=${v.newtown_soh}`);
  }
}

// 3. Show what fields a size-grid /Stock record has vs what the sync code reads
console.log('\n=== Checking "size" field specifically ===');
const sample = await cin7Get(`/Stock?rows=5&where=(code="SRS-SPA")`);
const sampleRecords = Array.isArray(sample) ? sample : (sample.data ?? []);
if (sampleRecords.length > 0) {
  const r = sampleRecords[0];
  console.log('\nFull first record:');
  console.log(JSON.stringify(r, null, 2));
}

// 4. Summary: what would the sync code produce for these records?
console.log('\n=== Simulating sync stock matching ===');
if (sampleRecords.length > 0) {
  const allVars = await imsDb.execute('SELECT variant_id, sku, barcode FROM ims_product_variants');
  const variantByCode = new Map(allVars[0].filter(r => r.sku).map(r => [r.sku, r.variant_id]));
  const variantByBarcode = new Map(allVars[0].filter(r => r.barcode).map(r => [r.barcode, r.variant_id]));

  for (const s of sampleRecords.slice(0, 5)) {
    const stockCode = (s.code ?? '').trim();
    const stockSize = (s.size ?? '').trim();
    const stockBarcode = (s.barcode ?? '').trim();
    const stockSkuFromSize = stockSize ? `${stockCode}-${stockSize}` : '';
    const match = variantByCode.get(stockCode)
      ?? (stockSkuFromSize ? variantByCode.get(stockSkuFromSize) : undefined)
      ?? (stockBarcode ? variantByBarcode.get(stockBarcode) : undefined);
    const tier = match
      ? (variantByCode.has(stockCode) ? 'direct code' : (stockSkuFromSize && variantByCode.has(stockSkuFromSize) ? 'code+size' : 'barcode'))
      : 'NO MATCH';
    console.log(`  code="${stockCode}" size="${stockSize}" barcode="${stockBarcode}" → ${match ? `MATCH (${tier})` : '❌ NO MATCH'}`);
  }
}

await imsDb.end();
console.log('\nDone.');
