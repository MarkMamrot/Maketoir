/**
 * Standalone full products sync: Cin7 â†’ IMS MySQL
 * Run with: node scripts/sync-products-full.mjs
 *
 * Syncs: locations â†’ products (active only) â†’ stock
 * Skips inactive products (status === 'Inactive') to reduce DB size.
 * No HTTP timeout â€” safe for 6,000+ SKUs.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createDecipheriv } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const dotenv = await import('dotenv');
dotenv.default.config({ path: join(__dirname, '../.env') });

const mysql = (await import('mysql2/promise')).default;

// â”€â”€ DB connections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mainDb = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const imsDb = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  database: process.env.IMS_MYSQL_DATABASE,
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});

const imsQuery  = async (sql, params = []) => { const [rows] = await imsDb.execute(sql, params); return rows; };
const imsExec   = async (sql, params = []) => { const [r]    = await imsDb.execute(sql, params); return r;    };

// â”€â”€ Decrypt Cin7 credentials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BUSINESS_ID = process.argv[2] || '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
console.log(`Business ID: ${BUSINESS_ID}`);

const [[connRow]] = await mainDb.execute(
  'SELECT cin7_account_id, cin7_api_key FROM connections WHERE business_id = ?',
  [BUSINESS_ID],
);
if (!connRow?.cin7_account_id) {
  console.error('ERROR: Cin7 credentials not found for this business.');
  process.exit(1);
}

const encKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const parts  = connRow.cin7_api_key.split(':');
const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(parts[0], 'hex'));
decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
const apiKey = decipher.update(Buffer.from(parts[2], 'hex')) + decipher.final('utf8');
const authHeader = 'Basic ' + Buffer.from(`${connRow.cin7_account_id}:${apiKey}`).toString('base64');

await mainDb.end();
console.log('Cin7 credentials loaded.\n');

// â”€â”€ Cin7 API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CIN7_BASE         = 'https://api.cin7.com/api/v1';
const PAGE_SIZE         = 250;
const REQUEST_DELAY_MS  = 1100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cin7Fetch(url, retryCount = 0) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (retryCount >= 3) throw new Error(`Cin7 network error: ${e.message}`);
    await sleep(Math.pow(2, retryCount) * 3000);
    return cin7Fetch(url, retryCount + 1);
  }
  if (res.status === 429) {
    if (retryCount >= 3) throw new Error('Cin7 rate limit exceeded after retries.');
    console.log(`  429 â€” waiting 60s before retry...`);
    await sleep(60_000);
    return cin7Fetch(url, retryCount + 1);
  }
  if (res.status >= 500) {
    if (retryCount >= 3) throw new Error(`Cin7 server error: HTTP ${res.status}`);
    await sleep(Math.pow(2, retryCount) * 2000);
    return cin7Fetch(url, retryCount + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cin7 error HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function cin7FetchAllPages(path, extraParams = {}) {
  const all = [];
  let page = 1;
  while (true) {
    const url = new URL(`${CIN7_BASE}${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    process.stdout.write(`  GET ${path} page ${page}...\r`);
    const data = await cin7Fetch(url.toString());
    const records = Array.isArray(data) ? data
      : (data?.data ?? data?.Branches ?? data?.branches ?? data?.records ?? data?.items ?? []);
    if (records.length === 0) break;
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
}

async function cin7ForEachPage(path, extraParams = {}, onPage) {
  let page = 1;
  let total = 0;
  while (true) {
    const url = new URL(`${CIN7_BASE}${path}`);
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    const data = await cin7Fetch(url.toString());
    const records = Array.isArray(data) ? data
      : (data?.data ?? data?.Branches ?? data?.branches ?? data?.records ?? data?.items ?? []);
    if (records.length === 0) break;
    await onPage(records, page);
    total += records.length;
    if (records.length < PAGE_SIZE) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return total;
}

// â”€â”€ IMS settings helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getImsSetting(key) {
  const rows = await imsQuery(
    'SELECT value FROM ims_settings WHERE business_id = ? AND `key` = ?',
    [BUSINESS_ID, key],
  );
  return rows[0]?.value ?? null;
}
async function setImsSetting(key, value) {
  await imsExec(
    'INSERT INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [BUSINESS_ID, key, value],
  );
}

// â”€â”€ UUID helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const { v4: uuidv4 } = await import('uuid');

// â”€â”€ Main sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

// â”€â”€â”€ Step A: Locations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('=== STEP 1/3: Locations ===');
const cin7Branches = await cin7FetchAllPages('/Branches');
console.log(`\n  Fetched ${cin7Branches.length} branches from Cin7`);

const existingLocs = await imsQuery('SELECT id, name FROM ims_locations');
const locMap = new Map(existingLocs.map(r => [r.name, r.id]));

let locNew = 0;
for (const b of cin7Branches) {
  const name    = (b.name ?? b.branchName ?? '').trim();
  const cin7Id  = b.id ?? b.branchId;
  const isActive = (b.isActive !== false && b.isActive !== 0) ? 1 : 0;
  if (!name || cin7Id == null) continue;

  if (!locMap.has(name)) {
    const res = await imsExec(
      'INSERT INTO ims_locations (name, code, is_active, cin7_branch_id) VALUES (?, ?, ?, ?)',
      [name, String(cin7Id), isActive, cin7Id],
    );
    locMap.set(name, res.insertId);
    locNew++;
  } else {
    await imsExec(
      'UPDATE ims_locations SET cin7_branch_id = ?, is_active = ? WHERE name = ?',
      [cin7Id, isActive, name],
    );
  }
}
console.log(`  ${locNew} new locations, ${cin7Branches.length} total. Done.\n`);

// â”€â”€â”€ Step B: Products (active only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('=== STEP 2/3: Products (full sync â€” active only) ===');
console.log('  Clearing existing Cin7 products from IMS...');

await imsExec(
  'DELETE FROM ims_stock WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
  [],
);
await imsExec(
  'UPDATE ims_purchase_order_items SET variant_id = NULL WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
  [],
);
await imsExec(
  'UPDATE ims_sales_order_items SET variant_id = NULL WHERE variant_id IN (SELECT variant_id FROM ims_product_variants WHERE cin7_option_id IS NOT NULL)',
  [],
);
await imsExec('DELETE FROM ims_product_variants WHERE cin7_option_id IS NOT NULL', []);
await imsExec('DELETE FROM ims_products WHERE cin7_product_id IS NOT NULL', []);
console.log('  Cleared. Fetching products from Cin7...');

// Load supplier contact map
const contactMapRows = await imsQuery(
  'SELECT id, cin7_supplier_id FROM ims_contacts WHERE cin7_supplier_id IS NOT NULL',
);
const supplierContactMap = new Map(contactMapRows.map(r => [r.cin7_supplier_id, r.id]));

const prodCin7Map = new Map();
const variantBySkuMap     = new Map(); // sku     â†’ variant_id
const variantByBarcodeMap = new Map(); // barcode â†’ variant_id (fallback for null-sku size-grid variants)
const visitedVariantKeys  = new Set(); // barcode|sku to prevent pagination-drift duplicates
const uniqueBrands = new Set();
let productNew = 0;
let variantSynced = 0;
let skippedInactive = 0;

const totalFetched = await cin7ForEachPage('/Products', {}, async (pageProducts, pageNum) => {
  const activeOnPage = pageProducts.filter(p => p.status !== 'Inactive').length;
  process.stdout.write(`  Page ${pageNum}: ${pageProducts.length} fetched, ${activeOnPage} active â€” products: ${productNew}, variants: ${variantSynced}, skipped: ${skippedInactive}\n`);

  for (const p of pageProducts) {
    const cin7Id = Number(p.id);
    if (!cin7Id || isNaN(cin7Id)) continue;
    if (p.status === 'Inactive') { skippedInactive++; continue; }

    const supplierContactId = p.supplierId ? (supplierContactMap.get(Number(p.supplierId)) ?? null) : null;
    const isOnlineRaw = p.customFields?.products_1004;
    const isOnline    = (isOnlineRaw === 1 || isOnlineRaw === '1') ? 1 : 0;
    const packSize    = p.customFields?.products_1005 ? Number(p.customFields.products_1005) : null;
    const zone        = p.customFields?.products_1001 ? String(p.customFields.products_1001).trim() : null;
    const bin         = p.customFields?.products_1002 ? String(p.customFields.products_1002).trim() : null;
    const productType = p.category || p.productType || null;
    const createdAt   = p.createdDate ? String(p.createdDate).slice(0, 10) : null;
    const tagsJson    = p.tags ? (Array.isArray(p.tags) ? JSON.stringify(p.tags) : String(p.tags)) : null;

    let imsProdId;
    if (!prodCin7Map.has(cin7Id)) {
      imsProdId = uuidv4();
      await imsExec(
        `INSERT INTO ims_products
           (product_id, name, description, product_type, brand, tags, style_code,
            is_active, is_online, supplier_contact_id, cin7_product_id,
            pack_size, zone, bin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          imsProdId, (p.name || '').trim() || 'Unknown',
          p.description || null, productType, p.brand || null,
          tagsJson, p.styleCode || null,
          isOnline, supplierContactId, cin7Id,
          packSize, zone, bin, createdAt,
        ],
      );
      prodCin7Map.set(cin7Id, imsProdId);
      productNew++;
    } else {
      imsProdId = prodCin7Map.get(cin7Id);
      await imsExec(
        `UPDATE ims_products
         SET name = ?, description = COALESCE(?, description),
             product_type = COALESCE(?, product_type), brand = ?,
             tags = ?, style_code = ?, is_active = 1, is_online = ?,
             supplier_contact_id = ?, pack_size = ?, zone = ?, bin = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?`,
        [
          (p.name || '').trim() || 'Unknown',
          p.description || null, productType, p.brand || null,
          tagsJson, p.styleCode || null,
          isOnline, supplierContactId, packSize, zone, bin,
          imsProdId,
        ],
      );
    }

    const opts      = Array.isArray(p.productOptions) ? p.productOptions : [];
    const opt1Name  = p.optionLabel1 || null;
    const opt2Name  = p.optionLabel2 || null;
    const opt3Name  = p.optionLabel3 || null;

    for (const opt of opts) {
      const cin7OptId = Number(opt.id ?? opt.productOptionId);
      if (!cin7OptId || isNaN(cin7OptId)) continue;
      // Derive unique SKU for size-grid products where opt.code is empty
      const optSku = opt.code || (
        opt.productOptionCode && opt.size ? `${opt.productOptionCode}-${opt.size}` : null
      );
      // Skip if this exact variant was already processed (Cin7 pagination drift can return same product twice)
      const variantKey = (opt.barcode || '') + ':' + (optSku || '') + ':' + cin7OptId;
      if (visitedVariantKeys.has(variantKey)) { continue; }
      visitedVariantKeys.add(variantKey);
      const opt1Value        = opt.option1 || opt.size || null;
      const opt1NameResolved = opt1Name || (opt.size ? 'Size' : null);

      const cost_aud        = opt.priceColumns?.cost_aud ?? opt.cost_aud ?? null;
      const price_rrp    = opt.price_rrp ?? opt.priceColumns?.price_rrp ?? null;
      const price_wholesale = opt.price_wholesale ?? opt.priceColumns?.price_wholesale ?? null;
      const weightKg       = opt.optionWeight != null ? Number(opt.optionWeight) : null;

      const foreignCosts = {};
      if (opt.priceColumns) {
        for (const [k, v] of Object.entries(opt.priceColumns)) {
          if (k.startsWith('cost') && k !== 'cost_aud' && v != null && Number(v) !== 0) {
            foreignCosts[k.replace('cost', '')] = Number(v);
          }
        }
      }
      const foreignCostJson = Object.keys(foreignCosts).length ? JSON.stringify(foreignCosts) : null;

      // Look up by SKU first, then barcode (for existing null-sku size-grid variants)
      const existingVariantId = (optSku ? variantBySkuMap.get(optSku) : undefined)
        ?? (opt.barcode ? variantByBarcodeMap.get(opt.barcode) : undefined);
      if (existingVariantId) {
        await imsExec(
          `UPDATE ims_product_variants SET
             product_id=?, sku=?, barcode=?,
             option1_name=?, option1_value=?, option2_name=?, option2_value=?,
             option3_name=?, option3_value=?,
             cost_aud=?, price_rrp=?, price_wholesale=?, cost_foreign=?,
             weight_kg=?, is_active=1, cin7_option_id=?, pack_size=?,
             updated_at=CURRENT_TIMESTAMP
           WHERE variant_id=?`,
          [
            imsProdId, optSku, opt.barcode || null,
            opt1NameResolved, opt1Value, opt2Name, opt.option2 || null,
            opt3Name, opt.option3 || null,
            cost_aud != null ? Number(cost_aud) : null,
            price_rrp != null ? Number(price_rrp) : null,
            price_wholesale != null ? Number(price_wholesale) : null,
            foreignCostJson, weightKg, cin7OptId, packSize,
            existingVariantId,
          ],
        );
        if (optSku) variantBySkuMap.set(optSku, existingVariantId);
        if (opt.barcode) variantByBarcodeMap.set(opt.barcode, existingVariantId);
      } else {
        const newVariantId = uuidv4();
        await imsExec(
          `INSERT INTO ims_product_variants
             (variant_id, product_id, sku, barcode,
              option1_name, option1_value, option2_name, option2_value, option3_name, option3_value,
              cost_aud, price_rrp, price_wholesale, cost_foreign,
              weight_kg, is_active, cin7_option_id, pack_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            newVariantId, imsProdId,
            optSku, opt.barcode || null,
            opt1NameResolved, opt1Value,
            opt2Name, opt.option2 || null,
            opt3Name, opt.option3 || null,
            cost_aud != null ? Number(cost_aud) : null,
            price_rrp != null ? Number(price_rrp) : null,
            price_wholesale != null ? Number(price_wholesale) : null,
            foreignCostJson, weightKg, cin7OptId, packSize,
          ],
        );
        if (optSku) variantBySkuMap.set(optSku, newVariantId);
        if (opt.barcode) variantByBarcodeMap.set(opt.barcode, newVariantId);
      }
      variantSynced++;
    }
    if (p.brand) uniqueBrands.add(p.brand.trim());
  }
});

// Upsert brands
for (const brand of uniqueBrands) {
  await imsExec(
    'INSERT INTO ims_brands (name) SELECT ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM ims_brands WHERE name = ?)',
    [brand, brand],
  );
}

await setImsSetting('last_products_sync', nowStr);
console.log(`\n  DONE: ${productNew} products, ${variantSynced} variants synced`);
console.log(`        ${skippedInactive} inactive products skipped (of ${totalFetched} fetched from Cin7)\n`);

// â”€â”€â”€ Step C: Stock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('=== STEP 3/3: Stock ===');
const cin7Stock = await cin7FetchAllPages('/Stock');
console.log(`\n  Fetched ${cin7Stock.length} stock records. Processing...`);

const allLocs = await imsQuery('SELECT id, cin7_branch_id, name FROM ims_locations');
const locByBranchId = new Map(allLocs.filter(r => r.cin7_branch_id != null).map(r => [r.cin7_branch_id, r.id]));
const locByName     = new Map(allLocs.map(r => [r.name, r.id]));

// Match stock by SKU (primary) or barcode (fallback for size-grid products where /Stock
// returns a shared product-level code but a unique barcode per size)
const allVariants = await imsQuery('SELECT variant_id, sku, barcode, cost_aud FROM ims_product_variants');
const variantByCode    = new Map(allVariants.filter(r => r.sku).map(r => [r.sku, { variantId: r.variant_id, cost: r.cost_aud }]));
const variantByBarcode = new Map(allVariants.filter(r => r.barcode).map(r => [r.barcode, { variantId: r.variant_id, cost: r.cost_aud }]));

const stockAgg = new Map();
for (const s of cin7Stock) {
  const cin7BranchId = Number(s.branchId ?? s.BranchId);
  const stockCode    = (s.code ?? '').trim();
  const stockSize    = (s.size ?? '').trim();
  const stockBarcode = (s.barcode ?? '').trim();
  // Skip only if there's no code AND no barcode (size-grid products have code="" but valid barcode)
  if ((!stockCode && !stockBarcode) || !cin7BranchId) continue;

  const stockSkuFromSize = stockSize ? `${stockCode}-${stockSize}` : '';
  const variantMatch = variantByCode.get(stockCode)
    ?? (stockSkuFromSize ? variantByCode.get(stockSkuFromSize) : undefined)
    ?? (stockBarcode ? variantByBarcode.get(stockBarcode) : undefined);
  if (!variantMatch) continue;
  const { variantId, cost: avgCostFallback } = variantMatch;

  const locationId = locByBranchId.get(cin7BranchId) ?? locByName.get((s.branchName ?? '').trim());
  if (!locationId) continue;

  const key = `${variantId}:${locationId}`;
  if (!stockAgg.has(key)) {
    stockAgg.set(key, { variantId, locationId, soh: 0, incoming: 0, committed: 0, avgCost: avgCostFallback ?? null });
  }
  const entry = stockAgg.get(key);
  entry.soh       += Number(s.stockOnHand ?? 0);
  entry.incoming  += Number(s.incoming    ?? 0);
  entry.committed += Number(s.openSales   ?? 0);
}

let stockSynced = 0;
for (const s of stockAgg.values()) {
  await imsExec(
    `INSERT INTO ims_stock (variant_id, location_id, qty_on_hand, qty_incoming, qty_committed, avg_cost)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       qty_on_hand   = VALUES(qty_on_hand),
       qty_incoming  = VALUES(qty_incoming),
       qty_committed = VALUES(qty_committed),
       avg_cost      = COALESCE(VALUES(avg_cost), avg_cost),
       updated_at    = CURRENT_TIMESTAMP`,
    [s.variantId, s.locationId, s.soh, s.incoming, s.committed, s.avgCost],
  );
  stockSynced++;
}

console.log(`  ${stockSynced} stock records synced.\n`);

// â”€â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await imsDb.end();
console.log('=== SYNC COMPLETE ===');
console.log(`  Locations: ${cin7Branches.length} checked`);
console.log(`  Products:  ${productNew} synced (${skippedInactive} inactive skipped)`);
console.log(`  Variants:  ${variantSynced} synced`);
console.log(`  Stock:     ${stockSynced} location records synced`);


