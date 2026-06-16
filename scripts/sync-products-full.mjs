/**
 * Standalone full products sync: Cin7 → IMS MySQL
 * Run with: node scripts/sync-products-full.mjs
 *
 * Syncs: locations → products (active only) → stock
 * Skips inactive products (status === 'Inactive') to reduce DB size.
 * No HTTP timeout — safe for 6,000+ SKUs.
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

// ── DB connections ──────────────────────────────────────────────────────────

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

// ── Decrypt Cin7 credentials ────────────────────────────────────────────────

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

// ── Cin7 API helpers ─────────────────────────────────────────────────────────

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
    console.log(`  429 — waiting 60s before retry...`);
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

// ── IMS settings helpers ─────────────────────────────────────────────────────

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

// ── UUID helper ──────────────────────────────────────────────────────────────

const { v4: uuidv4 } = await import('uuid');

// ── Main sync ────────────────────────────────────────────────────────────────

const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

// ─── Step A: Locations ───────────────────────────────────────────────────────
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

// ─── Step B: Products (active only) ─────────────────────────────────────────
console.log('=== STEP 2/3: Products (full sync — active only) ===');
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
const variantBySkuMap = new Map(); // sku → variant_id (for size-grid de-duplication)
const uniqueBrands = new Set();
let productNew = 0;
let variantSynced = 0;
let skippedInactive = 0;

const totalFetched = await cin7ForEachPage('/Products', {}, async (pageProducts, pageNum) => {
  const activeOnPage = pageProducts.filter(p => p.status !== 'Inactive').length;
  process.stdout.write(`  Page ${pageNum}: ${pageProducts.length} fetched, ${activeOnPage} active — products: ${productNew}, variants: ${variantSynced}, skipped: ${skippedInactive}\n`);

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
      const optSku = opt.code || null;

      const costAUD        = opt.priceColumns?.costAUD ?? opt.cost ?? null;
      const retailPrice    = opt.retailPrice ?? opt.priceColumns?.priceRetail ?? null;
      const wholesalePrice = opt.wholesalePrice ?? opt.priceColumns?.priceWholesale ?? null;
      const weightKg       = opt.optionWeight != null ? Number(opt.optionWeight) : null;

      const foreignCosts = {};
      if (opt.priceColumns) {
        for (const [k, v] of Object.entries(opt.priceColumns)) {
          if (k.startsWith('cost') && k !== 'costAUD' && v != null && Number(v) !== 0) {
            foreignCosts[k.replace('cost', '')] = Number(v);
          }
        }
      }
      const foreignCostJson = Object.keys(foreignCosts).length ? JSON.stringify(foreignCosts) : null;

      // Look up existing by SKU to handle size-grid products (shared cin7_option_id)
      const existingVariantId = optSku ? variantBySkuMap.get(optSku) : undefined;
      if (existingVariantId) {
        await imsExec(
          `UPDATE ims_product_variants SET
             product_id=?, barcode=?,
             option1_name=?, option1_value=?, option2_name=?, option2_value=?,
             option3_name=?, option3_value=?,
             cost=?, price=?, wholesale_price=?, cost_foreign_json=?,
             weight_kg=?, is_active=1, cin7_option_id=?, pack_size=?,
             updated_at=CURRENT_TIMESTAMP
           WHERE variant_id=?`,
          [
            imsProdId, opt.barcode || null,
            opt1Name, opt.option1 || null, opt2Name, opt.option2 || null,
            opt3Name, opt.option3 || null,
            costAUD != null ? Number(costAUD) : null,
            retailPrice != null ? Number(retailPrice) : null,
            wholesalePrice != null ? Number(wholesalePrice) : null,
            foreignCostJson, weightKg, cin7OptId, packSize,
            existingVariantId,
          ],
        );
      } else {
        const newVariantId = uuidv4();
        await imsExec(
          `INSERT INTO ims_product_variants
             (variant_id, product_id, sku, barcode,
              option1_name, option1_value, option2_name, option2_value, option3_name, option3_value,
              cost, price, wholesale_price, cost_foreign_json,
              weight_kg, is_active, cin7_option_id, pack_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            newVariantId, imsProdId,
            optSku, opt.barcode || null,
            opt1Name, opt.option1 || null,
            opt2Name, opt.option2 || null,
            opt3Name, opt.option3 || null,
            costAUD != null ? Number(costAUD) : null,
            retailPrice != null ? Number(retailPrice) : null,
            wholesalePrice != null ? Number(wholesalePrice) : null,
            foreignCostJson, weightKg, cin7OptId, packSize,
          ],
        );
        if (optSku) variantBySkuMap.set(optSku, newVariantId);
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

// ─── Step C: Stock ───────────────────────────────────────────────────────────
console.log('=== STEP 3/3: Stock ===');
const cin7Stock = await cin7FetchAllPages('/Stock');
console.log(`\n  Fetched ${cin7Stock.length} stock records. Processing...`);

const allLocs = await imsQuery('SELECT id, cin7_branch_id, name FROM ims_locations');
const locByBranchId = new Map(allLocs.filter(r => r.cin7_branch_id != null).map(r => [r.cin7_branch_id, r.id]));
const locByName     = new Map(allLocs.map(r => [r.name, r.id]));

// Match stock by code (SKU) — handles size-grid products where all sizes share the same productOptionId
const allVariants = await imsQuery('SELECT variant_id, sku, cost FROM ims_product_variants WHERE sku IS NOT NULL');
const variantByCode = new Map(allVariants.map(r => [r.sku, { variantId: r.variant_id, cost: r.cost }]));

const stockAgg = new Map();
for (const s of cin7Stock) {
  const cin7BranchId = Number(s.branchId ?? s.BranchId);
  const stockCode    = (s.code ?? '').trim();
  if (!stockCode || !cin7BranchId) continue;

  const variantMatch = variantByCode.get(stockCode);
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

// ─── Done ────────────────────────────────────────────────────────────────────
await imsDb.end();
console.log('=== SYNC COMPLETE ===');
console.log(`  Locations: ${cin7Branches.length} checked`);
console.log(`  Products:  ${productNew} synced (${skippedInactive} inactive skipped)`);
console.log(`  Variants:  ${variantSynced} synced`);
console.log(`  Stock:     ${stockSynced} location records synced`);
