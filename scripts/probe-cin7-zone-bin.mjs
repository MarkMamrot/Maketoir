/**
 * Probes Cin7 /Products and /Stock to find zone/bin fields.
 * Usage: node scripts/probe-cin7-zone-bin.mjs
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
const BASE      = 'https://api.cin7.com/api/v1';

async function cin7Get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Basic ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

function findInteresting(obj, prefix = '') {
  const hits = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    const lk = k.toLowerCase();
    if (lk.includes('zone') || lk.includes('bin') || lk.includes('location') || lk.includes('shelf') || lk.includes('aisle')) {
      hits.push({ key: fullKey, value: v });
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      hits.push(...findInteresting(v, fullKey));
    }
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      hits.push(...findInteresting(v[0], `${fullKey}[0]`));
    }
  }
  return hits;
}

// ── 1. Products — check product + productOptions level ───────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  /Products  (first 3 products, first option)');
console.log('══════════════════════════════════════════════');

const products = await cin7Get('/Products?rows=3&page=1');
for (const p of products.slice(0, 3)) {
  console.log(`\nProduct: ${p.name} (id=${p.id})`);
  console.log('  TOP-LEVEL KEYS:', Object.keys(p).join(', '));

  const interesting = findInteresting(p);
  if (interesting.length) {
    console.log('  *** ZONE/BIN FIELDS FOUND:');
    interesting.forEach(h => console.log(`     ${h.key} = ${JSON.stringify(h.value)}`));
  } else {
    console.log('  (no zone/bin/location keys at product level)');
  }

  if (Array.isArray(p.productOptions) && p.productOptions.length > 0) {
    const opt = p.productOptions[0];
    console.log('  productOptions[0] KEYS:', Object.keys(opt).join(', '));
    const optInteresting = findInteresting(opt, 'productOptions[0]');
    if (optInteresting.length) {
      console.log('  *** ZONE/BIN IN OPTION:');
      optInteresting.forEach(h => console.log(`     ${h.key} = ${JSON.stringify(h.value)}`));
    } else {
      console.log('  (no zone/bin/location keys at variant level)');
    }
  }
}

// ── 2. Stock — check all keys including any with zone/bin ────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  /Stock  (first page, all unique key names)');
console.log('══════════════════════════════════════════════');

const stockRecords = await cin7Get('/Stock?rows=50&page=1');
console.log(`\nTotal records on first page: ${stockRecords.length}`);

if (stockRecords.length > 0) {
  // Collect all unique keys across all records
  const allKeys = new Set();
  for (const s of stockRecords) Object.keys(s).forEach(k => allKeys.add(k));
  console.log('\nAll keys across stock records:', [...allKeys].join(', '));

  // Find any zone/bin fields with non-null values
  const nonNullInteresting = [];
  for (const s of stockRecords) {
    const hits = findInteresting(s);
    hits.forEach(h => {
      if (h.value != null && h.value !== '' && h.value !== 0) {
        nonNullInteresting.push({ ...h, branchName: s.branchName, code: s.code });
      }
    });
  }

  if (nonNullInteresting.length) {
    console.log('\n*** ZONE/BIN FIELDS WITH VALUES:');
    const seen = new Set();
    for (const h of nonNullInteresting) {
      const dedup = `${h.key}=${JSON.stringify(h.value)}`;
      if (!seen.has(dedup)) {
        seen.add(dedup);
        console.log(`  [branch=${h.branchName}, sku=${h.code}] ${h.key} = ${JSON.stringify(h.value)}`);
      }
    }
  } else {
    console.log('\n(no zone/bin fields with values on first page)');
    console.log('Showing first stock record in full:');
    console.log(JSON.stringify(stockRecords[0], null, 2));
  }

  // Also show a warehouse-branch record if one exists
  const warehouseRecord = stockRecords.find(s =>
    (s.branchName ?? '').toLowerCase().includes('warehouse') ||
    (s.branchName ?? '').toLowerCase().includes('wh'),
  );
  if (warehouseRecord) {
    console.log('\nWarehouse branch stock record (full):');
    console.log(JSON.stringify(warehouseRecord, null, 2));
  }
}

console.log('\nDone.');
