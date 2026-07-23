/**
 * Fetch a sample of gift cards from Monsterthreads Shopify and compare
 * against the local gift_cards table schema.
 * Usage: node scripts/_check-shopify-gift-cards.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import mysql from 'mysql2/promise';
import { createDecipheriv } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function decrypt(stored) {
  if (!stored) return '';
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, encHex] = parts;
  if (ivHex.length !== 24 || authTagHex.length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DATABASE, user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD, connectTimeout: 20000,
});

// Get Monsterthreads Shopify credentials
const [rows] = await conn.query(
  `SELECT c.shopify_shop_id, c.shopify_access_token
   FROM connections c
   JOIN businesses b ON b.business_id = c.business_id
   WHERE b.ims_db_name = 'readyedu_MonsterthreadsIMS'
   LIMIT 1`
);
if (!rows.length || !rows[0].shopify_shop_id) {
  console.error('No Shopify connection found for Monsterthreads.');
  process.exit(1);
}
const shopId    = rows[0].shopify_shop_id;
const shopToken = decrypt(rows[0].shopify_access_token);
await conn.end();

const API = `https://${shopId}/admin/api/2024-04`;

async function shopifyGet(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'X-Shopify-Access-Token': shopToken, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Fetch a few enabled gift cards
console.log(`\nShop: ${shopId}`);
console.log('Fetching enabled gift cards (limit 5)…\n');
const data = await shopifyGet('/gift_cards.json?status=enabled&limit=5');
const cards = data.gift_cards ?? [];
console.log(`Got ${cards.length} card(s). Full shape of first card:\n`);
if (cards.length) console.log(JSON.stringify(cards[0], null, 2));

// Also fetch one disabled card for comparison
console.log('\nFetching disabled/redeemed gift cards (limit 3)…\n');
const disabledData = await shopifyGet('/gift_cards.json?status=disabled&limit=3');
const disabled = disabledData.gift_cards ?? [];
if (disabled.length) {
  console.log('Sample disabled card:\n');
  console.log(JSON.stringify(disabled[0], null, 2));
}

// Count totals
const countData = await shopifyGet('/gift_cards/count.json');
const disCountData = await shopifyGet('/gift_cards/count.json?status=disabled');
console.log(`\nTotal enabled:  ${countData.count}`);
console.log(`Total disabled: ${disCountData.count}`);

// Summary of fields found
if (cards.length || disabled.length) {
  const sample = cards[0] ?? disabled[0];
  console.log('\n── Shopify gift card fields ──────────────────');
  for (const [k, v] of Object.entries(sample)) {
    console.log(`  ${k.padEnd(25)} ${JSON.stringify(v)}`);
  }
}
