/**
 * test-cin7-put-diag.mjs
 * Quick diagnostic: verify Cin7 auth + test a PUT with timeout tracking.
 * Usage: node scripts/test-cin7-put-diag.mjs
 */
import 'dotenv/config';
import { google } from 'googleapis';
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

// Load creds
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
console.log(`Account ID: ${accountId}`);
console.log(`API Key decrypted: ${apiKey ? 'YES (' + apiKey.length + ' chars)' : 'EMPTY — check ENCRYPTION_KEY'}\n`);

const CIN7 = 'https://api.cin7.com/api/v1';

// ── Test 1: Simple GET (list 1 product) ──────────────────────────────────────
console.log('── TEST 1: GET /Products (1 row) ──');
const t1 = Date.now();
try {
  const res = await fetch(`${CIN7}/Products?rows=1&page=1`, {
    headers: { Authorization: AUTH },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  console.log(`  HTTP ${res.status} — ${Date.now() - t1}ms`);
  if (Array.isArray(body) && body.length > 0) {
    console.log(`  First product id=${body[0].id} name="${body[0].name}"`);
  } else {
    console.log('  Response:', JSON.stringify(body).slice(0, 300));
  }
} catch (e) {
  console.log(`  ERROR after ${Date.now() - t1}ms:`, e.message);
}

// ── Test 2: PUT a harmless no-op (send current name back) ───────────────────
console.log('\n── TEST 2: PUT /Products (no-op update — sends name back unchanged) ──');
let testId = null;
let testName = null;
try {
  const res = await fetch(`${CIN7}/Products?rows=1&page=1`, {
    headers: { Authorization: AUTH },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (Array.isArray(body) && body.length > 0) {
    testId = body[0].id;
    testName = body[0].name;
  }
} catch {}

if (testId) {
  console.log(`  Using product id=${testId} name="${testName}"`);
  const t2 = Date.now();
  try {
    const res = await fetch(`${CIN7}/Products`, {
      method: 'PUT',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ id: testId, name: testName }]),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json();
    console.log(`  HTTP ${res.status} — ${Date.now() - t2}ms`);
    const result = Array.isArray(body) ? body[0] : body;
    if (result?.success === false) {
      console.log('  Cin7 error:', (result.errors ?? []).join('; ') || JSON.stringify(result));
    } else {
      console.log('  Result:', JSON.stringify(result).slice(0, 300));
    }
  } catch (e) {
    console.log(`  ERROR after ${Date.now() - t2}ms:`, e.message);
  }
} else {
  console.log('  Skipped — could not fetch a product to test with.');
}

console.log('\nDone.');
