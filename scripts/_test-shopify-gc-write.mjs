/**
 * Test: create a minimal gift card in Shopify, verify the response shape,
 * then immediately disable it (clean up).
 * Usage: node scripts/_test-shopify-gc-write.mjs
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
const [rows] = await conn.query(
  `SELECT c.shopify_shop_id, c.shopify_access_token
   FROM connections c
   JOIN businesses b ON b.business_id = c.business_id
   WHERE b.ims_db_name = 'readyedu_MonsterthreadsIMS' LIMIT 1`
);
await conn.end();

if (!rows.length || !rows[0].shopify_shop_id) {
  console.error('No Shopify connection found.'); process.exit(1);
}
const shopId    = rows[0].shopify_shop_id;
const shopToken = decrypt(rows[0].shopify_access_token);
const API       = `https://${shopId}/admin/api/2024-04`;

async function shopifyPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shopToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ── Step 1: Create a $0.01 test gift card ────────────────────────────────────
console.log('Creating $0.01 test gift card…');
let created;
try {
  const data = await shopifyPost('/gift_cards.json', {
    gift_card: {
      initial_value: '0.01',
      note: 'POS integration write-access test — safe to delete',
    },
  });
  created = data.gift_card;
} catch (e) {
  console.error('CREATE failed:', e.message);
  process.exit(1);
}

console.log('\n── Created gift card response ──────────────────');
for (const [k, v] of Object.entries(created)) {
  console.log(`  ${k.padEnd(25)} ${JSON.stringify(v)}`);
}

// ── Step 2: Check if full `code` is present ──────────────────────────────────
console.log(`\n✓ Full code returned: ${created.code ? `YES → "${created.code}"` : 'NO (field absent)'}`);
console.log(`  Shopify ID: ${created.id}`);
console.log(`  Last chars: ${created.last_characters}`);

// ── Step 3: Immediately disable the test card ────────────────────────────────
console.log('\nDisabling test card…');
try {
  const dis = await shopifyPost(`/gift_cards/${created.id}/disable.json`, {});
  console.log(`✓ Disabled. disabled_at: ${dis.gift_card?.disabled_at}`);
} catch (e) {
  console.error('DISABLE failed (manual cleanup needed for id', created.id, '):', e.message);
}
