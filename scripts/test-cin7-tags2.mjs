/**
 * Deeper Cin7 tags + ProductImages investigation.
 * Usage:  node scripts/test-cin7-tags2.mjs
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
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── GET the full product ──────────────────────────────────────────────────────
const { json: products } = await fetchJSON(`${BASE}/Products?rows=1&where=styleCode='MAGW-645'`);
const p = Array.isArray(products) ? products[0] : null;
if (!p) { console.log('Product not found:', products); process.exit(1); }
console.log('=== FULL PRODUCT OBJECT ===');
console.log(JSON.stringify(p, null, 2));
await sleep(1000);

// ── Test 1: SET tags to empty string (should "clear" per docs) ────────────────
console.log('\n── PUT tags="" (empty string — should clear) ───────────────────────');
const t1 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, tags: '' }]),
});
console.log('HTTP', t1.status, JSON.stringify(t1.json));
await sleep(2000);
const v1 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}&fields=id,tags`);
console.log('→ tags after empty-string:', JSON.stringify(v1.json[0]?.tags));

// ── Test 2: Try customFields — inspect structure then add a value ─────────────
console.log('\n── customFields structure ──────────────────────────────────────────');
console.log(JSON.stringify(p.customFields, null, 2));

// ── Test 3: tags as an array of objects [{id,name}] ──────────────────────────
await sleep(1000);
console.log('\n── PUT tags=[{id:0,name:"WEBREADY"}] ──────────────────────────────');
const t3 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, tags: [{ id: 0, name: 'WEBREADY' }] }]),
});
console.log('HTTP', t3.status, JSON.stringify(t3.json));
await sleep(2000);
const v3 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}&fields=id,tags`);
console.log('→ tags after object-array:', JSON.stringify(v3.json[0]?.tags));

// ── Test 4: label field instead of tags ───────────────────────────────────────
await sleep(1000);
console.log('\n── PUT label="WEBREADY" (in case it is label not tags) ─────────────');
const t4 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, label: 'WEBREADY' }]),
});
console.log('HTTP', t4.status, JSON.stringify(t4.json));
await sleep(2000);
const v4 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}&fields=id,tags,label`);
console.log('→ tags/label after label PUT:', JSON.stringify({ tags: v4.json[0]?.tags, label: v4.json[0]?.label }));

// ── Test 5: Use name+description+tags all together ────────────────────────────
await sleep(1000);
console.log('\n── PUT name+description+tags together ─────────────────────────────');
const t5 = await fetchJSON(`${BASE}/Products`, {
  method: 'PUT',
  body: JSON.stringify([{ id: p.id, name: p.name, description: p.description, tags: 'WEBREADY' }]),
});
console.log('HTTP', t5.status, JSON.stringify(t5.json));
await sleep(2000);
const v5 = await fetchJSON(`${BASE}/Products?rows=1&where=id=${p.id}&fields=id,tags`);
console.log('→ tags after name+desc+tags PUT:', JSON.stringify(v5.json[0]?.tags));

// ── Test 6: ProductImages endpoint ────────────────────────────────────────────
await sleep(1000);
console.log('\n── POST /ProductImages — check what format it wants ────────────────');
// Try with a real test image URL (small, publicly accessible)
const imgTest = await fetchJSON(
  `${BASE}/ProductImages?productId=${p.id}&imagePriority=1`,
  {
    method: 'POST',
    body: JSON.stringify({ url: 'https://via.placeholder.com/400x400.jpg' }),
  }
);
console.log('HTTP', imgTest.status, JSON.stringify(imgTest.json).slice(0, 500));

// Also try form with imageUrl field
await sleep(1000);
const imgTest2 = await fetchJSON(
  `${BASE}/ProductImages?productId=${p.id}&imagePriority=1`,
  {
    method: 'POST',
    body: JSON.stringify({ imageUrl: 'https://via.placeholder.com/400x400.jpg' }),
  }
);
console.log('imageUrl field HTTP', imgTest2.status, JSON.stringify(imgTest2.json).slice(0, 500));

// Also try raw string body
await sleep(1000);
const imgTest3 = await fetch(`${BASE}/ProductImages?productId=${p.id}&imagePriority=1`, {
  method: 'POST',
  headers: { Authorization: `Basic ${token}`, 'Content-Type': 'text/plain' },
  body: 'https://via.placeholder.com/400x400.jpg',
});
console.log('raw string HTTP', imgTest3.status, await imgTest3.text().then(t => t.slice(0, 500)));

console.log('\n─── DONE ───────────────────────────────────────────────────────────');
