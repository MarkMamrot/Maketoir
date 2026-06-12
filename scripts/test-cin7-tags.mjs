/**
 * Test script: diagnose why tags won't write to a Cin7 product.
 * Usage:  node scripts/test-cin7-tags.mjs [styleCode]
 * Default style code: MAGW-645
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { createDecipheriv } from 'crypto';

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

// ── Load creds ────────────────────────────────────────────────────────────────
const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8') : null;
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
const apiKey    = decrypt(get('Cin7ApiKey'));
const token     = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
const BASE = 'https://api.cin7.com/api/v1';

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json', ...opts.headers }, ...opts });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const styleCode = process.argv[2] || 'MAGW-645';

// ── Step 1: GET the product ───────────────────────────────────────────────────
console.log(`\n── GET product (styleCode=${styleCode}) ────────────────────────────`);
const { status: getStatus, json: products } = await fetchJSON(
  `${BASE}/Products?rows=5&where=styleCode='${styleCode}'`
);
console.log('HTTP', getStatus);
if (!Array.isArray(products) || products.length === 0) {
  console.log('No product found. Raw response:', JSON.stringify(products, null, 2));
  process.exit(1);
}

const p = products[0];
console.log('id          :', p.id);
console.log('name        :', p.name);
console.log('styleCode   :', p.styleCode);
console.log('tags (raw)  :', JSON.stringify(p.tags));
console.log('tags type   :', typeof p.tags);
console.log('description :', (p.description ?? '').slice(0, 80));

// Show ALL keys that exist on this product object
console.log('\nAll product keys:', Object.keys(p).join(', '));

await new Promise(res => setTimeout(res, 1000));

// ── Step 2: Try writing tags as a plain string ────────────────────────────────
console.log('\n── PUT: tags as plain string ───────────────────────────────────────');
const put1 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, tags: 'WEBREADY' }]),
});
console.log('HTTP', put1.status, JSON.stringify(put1.json));
await new Promise(res => setTimeout(res, 2000));

// Verify
const verify1 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}`);
console.log('→ tags after plain-string PUT:', JSON.stringify(verify1.json[0]?.tags));

await new Promise(res => setTimeout(res, 1000));

// ── Step 3: Try writing tags as an array (in case Cin7 expects array) ─────────
console.log('\n── PUT: tags as array ──────────────────────────────────────────────');
const put2 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, tags: ['WEBREADY'] }]),
});
console.log('HTTP', put2.status, JSON.stringify(put2.json));
await new Promise(res => setTimeout(res, 2000));

const verify2 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}`);
console.log('→ tags after array PUT:', JSON.stringify(verify2.json[0]?.tags));

await new Promise(res => setTimeout(res, 1000));

// ── Step 4: Try sending name + tags together (in case isolated tags is ignored) ─
console.log('\n── PUT: name + tags together ───────────────────────────────────────');
const put3 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, name: p.name, tags: 'WEBREADY' }]),
});
console.log('HTTP', put3.status, JSON.stringify(put3.json));
await new Promise(res => setTimeout(res, 2000));

const verify3 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}`);
console.log('→ tags after name+tags PUT:', JSON.stringify(verify3.json[0]?.tags));

await new Promise(res => setTimeout(res, 1000));

// ── Step 5: Try full product object with tags replaced ────────────────────────
console.log('\n── PUT: full product object with tags="WEBREADY" ───────────────────');
const fullPayload = { ...p, tags: 'WEBREADY' };
const put4 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([fullPayload]),
});
console.log('HTTP', put4.status, JSON.stringify(put4.json).slice(0, 400));
await new Promise(res => setTimeout(res, 2000));

const verify4 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}`);
console.log('→ tags after full-object PUT:', JSON.stringify(verify4.json[0]?.tags));

// ── Step 6: Check the Cin7 product variants endpoint ─────────────────────────
console.log('\n── GET /Products/{id} direct (if supported) ────────────────────────');
const single = await fetchJSON(`${BASE}/Products/${p.id}`);
console.log('HTTP', single.status, JSON.stringify(single.json).slice(0, 300));

console.log('\n─── DONE ───────────────────────────────────────────────────────────');
