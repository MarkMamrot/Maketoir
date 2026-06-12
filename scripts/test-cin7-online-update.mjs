/**
 * test-cin7-online-update.mjs
 *
 * Iterates through different PUT strategies to update products_1004 (online field)
 * to -4 for product BC4439 (id=17164). Pauses between each method so you can
 * check Cin7 and confirm whether it worked.
 *
 * Usage:  node scripts/test-cin7-online-update.mjs
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';
import readline from 'readline';

// ── Helpers ─────────────────────────────────────────────────────────────────

function decrypt(stored) {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0].length !== 24 || parts[1].length !== 32) return stored;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pause = (msg = '\nPress ENTER to try next method (or Ctrl+C to stop)...') =>
  new Promise(resolve => rl.question(msg, resolve));

// ── Load Cin7 credentials from Sheets ───────────────────────────────────────

const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const r = await sheets.spreadsheets.values.get({
  spreadsheetId: '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps',
  range: 'Connections!A1:Z2',
});
const [hdrs, vals] = r.data.values;
const get = k => vals[hdrs.indexOf(k)] ?? '';
const accountId = get('Cin7AccountId');
const apiKey = decrypt(get('Cin7ApiKey'));
const AUTH = `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`;

const PRODUCT_ID = 17164;
const STYLE_CODE = 'BC4439';
const TARGET_VALUE_INT = -4;
const TARGET_VALUE_STR = '-4';

// ── Fetch current product state ──────────────────────────────────────────────

async function getCurrentProduct() {
  const res = await fetch(
    `https://api.cin7.com/api/v1/Products?rows=5&page=1&where=styleCode%3D'${STYLE_CODE}'`,
    { headers: { Authorization: AUTH } },
  );
  const body = await res.json();
  const product = Array.isArray(body) ? body[0] : null;
  return product;
}

async function showCurrentState() {
  const p = await getCurrentProduct();
  if (!p) { console.log('  ⚠️  Product not found via GET!'); return null; }
  console.log(`  Current id=${p.id}  status=${p.status}  channels=${JSON.stringify(p.channels)}  customFields=${JSON.stringify(p.customFields ?? {})}`);
  return p;
}

function stripHtml(str) {
  if (!str) return str;
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;#39;/g, "'").trim();
}

async function tryPut(label, payload) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`METHOD: ${label}`);
  console.log('Payload:', JSON.stringify(payload));
  const res = await fetch('https://api.cin7.com/api/v1/Products', {
    method: 'PUT',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(payload) ? payload : [payload]),
  });
  const body = await res.json();
  console.log(`PUT HTTP ${res.status} →`, JSON.stringify(Array.isArray(body) ? body[0] : body));

  // Small delay then verify
  await new Promise(r => setTimeout(r, 1500));
  console.log('Verifying via GET...');
  await showCurrentState();
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('=== Cin7 Online Field Update Test (round 2) ===');
console.log(`Product: ${STYLE_CODE}  id=${PRODUCT_ID}`);
console.log('\n--- Current state ---');
const fullProduct = await showCurrentState();

if (!fullProduct) {
  console.error('Could not load product. Exiting.');
  rl.close();
  process.exit(1);
}

// ── Method 10: top-level channels via minimal PUT ────────────────────────────
const SHOPIFY_CHANNEL = 'Shopify https://monsterthreads.myshopify.com/';

await tryPut(
  '10 — minimal PUT: channels = Shopify URL',
  { id: PRODUCT_ID, channels: SHOPIFY_CHANNEL },
);
await pause('\nCheck Cin7 — did channels field update? Press ENTER for next method...');

// ── Method 11: full object (no sizeRangeId, no description), channels field ──
const freshProduct = await getCurrentProduct();
const { sizeRangeId: _s, description: _d, ...freshStripped } = freshProduct;

await tryPut(
  '11 — FULL (no sizeRangeId, no description): channels = Shopify URL',
  { ...freshStripped, channels: SHOPIFY_CHANNEL },
);
await pause('\nCheck Cin7 — did channels update in full PUT? Press ENTER to finish...');

console.log('\n=== All methods tried. Final state: ===');
await showCurrentState();

rl.close();
