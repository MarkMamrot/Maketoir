/**
 * _backfill-shopify-sku-barcode.mjs
 *
 * One-off script: pushes the IMS sku + barcode for every Shopify-linked variant
 * back to Shopify. Run this once to fix products that were synced before the
 * shopify-sync route was updated to include sku/barcode in updates.
 *
 * Usage:
 *   node scripts/_backfill-shopify-sku-barcode.mjs
 *
 * Optional — restrict to one business:
 *   BUSINESS_ID=abc123 node scripts/_backfill-shopify-sku-barcode.mjs
 *
 * Dry-run (print what would be changed, no writes):
 *   DRY_RUN=1 node scripts/_backfill-shopify-sku-barcode.mjs
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN       = process.env.DRY_RUN === '1';
const ONLY_BIZ      = process.env.BUSINESS_ID ?? null;
const RATE_LIMIT_MS = 650; // ~1.5 req/s — safely under Shopify's 2 req/s REST limit

if (DRY_RUN) console.log('⚠️  DRY RUN — no changes will be written to Shopify.\n');

// ── Decrypt helper (mirrors src/lib/encryption.ts) ───────────────────────────

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored; // plain text (legacy)
  const [ivHex, authTagHex, encHex] = parts;
  if (ivHex.length !== 24 || authTagHex.length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
}

// ── DB connections ────────────────────────────────────────────────────────────

const ims = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.IMS_MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

// The 'connections' table (Shopify credentials) lives in the main DB
const main = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function updateShopifyVariant(shopName, accessToken, shopifyVariantId, sku, barcode) {
  const url = `https://${shopName}.myshopify.com/admin/api/2024-01/variants/${shopifyVariantId}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: { id: parseInt(shopifyVariantId), sku, barcode } }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) {
    const wait = (parseInt(res.headers.get('Retry-After') || '5') + 1) * 1000;
    console.log(`    ⏳ Rate-limited — waiting ${wait}ms…`);
    await sleep(wait);
    return updateShopifyVariant(shopName, accessToken, shopifyVariantId, sku, barcode);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

// 1. Get businesses with Shopify connected
const bizQuery = ONLY_BIZ
  ? `SELECT DISTINCT business_id FROM connections WHERE business_id = ? AND shopify_shop_id IS NOT NULL AND shopify_shop_id != ''`
  : `SELECT DISTINCT business_id FROM connections WHERE shopify_shop_id IS NOT NULL AND shopify_shop_id != ''`;
const bizParams = ONLY_BIZ ? [ONLY_BIZ] : [];
const [bizRows] = await main.query(bizQuery, bizParams);

console.log(`Found ${bizRows.length} business(es) with Shopify configured.\n`);

let totalOk = 0, totalErr = 0;

for (const { business_id } of bizRows) {
  // 2. Fetch Shopify credentials
  const [[conn]] = await main.query(
    `SELECT shopify_shop_id, shopify_access_token FROM connections WHERE business_id = ? LIMIT 1`,
    [business_id]
  );
  if (!conn?.shopify_shop_id || !conn?.shopify_access_token) {
    console.log(`[${business_id}] No credentials — skipped.`);
    continue;
  }
  const shopName    = String(conn.shopify_shop_id).replace(/\.myshopify\.com$/, '');
  const accessToken = decrypt(conn.shopify_access_token);
  if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
    console.log(`[${business_id}] Invalid shop name "${shopName}" — skipped.`);
    continue;
  }

  // 3. Fetch all linked IMS variants that have a sku or barcode
  const [variants] = await ims.query(`
    SELECT v.variant_id, v.shopify_variant_id,
           COALESCE(v.sku, '')     AS sku,
           COALESCE(v.barcode, '') AS barcode,
           p.name AS product_name
    FROM ims_product_variants v
    JOIN ims_products p ON p.product_id = v.product_id
    WHERE v.business_id = ?
      AND v.is_active = 1
      AND v.shopify_variant_id IS NOT NULL AND v.shopify_variant_id != ''
      AND (v.sku IS NOT NULL AND v.sku != ''
           OR v.barcode IS NOT NULL AND v.barcode != '')
    ORDER BY p.name, v.sku
  `, [business_id]);

  console.log(`[${business_id}] ${variants.length} variant(s) to sync → ${shopName}.myshopify.com`);
  if (variants.length === 0) { console.log(); continue; }

  for (const v of variants) {
    if (DRY_RUN) {
      console.log(`  [DRY] id=${v.shopify_variant_id}  sku="${v.sku}"  barcode="${v.barcode}"  (${v.product_name})`);
      totalOk++;
      continue;
    }
    try {
      await updateShopifyVariant(shopName, accessToken, v.shopify_variant_id, v.sku, v.barcode);
      console.log(`  ✓ ${v.shopify_variant_id}  sku="${v.sku}"  barcode="${v.barcode}"  (${v.product_name})`);
      totalOk++;
    } catch (err) {
      console.error(`  ❌ ${v.shopify_variant_id} — ${err.message}`);
      totalErr++;
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log();
}

await ims.end();
await main.end();

console.log('─────────────────────────────────────────');
console.log(`Done.  ✓ ${totalOk} updated   ❌ ${totalErr} errors`);
if (DRY_RUN) console.log('(Dry run — no changes were written to Shopify.');
