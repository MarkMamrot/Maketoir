/**
 * Import Lightspeed / Sage POS customers into the Sage IMS database.
 *
 * Reads all CSV files from customers/ directory, deduplicates by customer_code
 * (first occurrence wins across files), then bulk-upserts into ims_contacts in
 * readyedu_SageIMS using ON DUPLICATE KEY UPDATE so the script is safe to re-run.
 *
 * Usage:
 *   node scripts/import-lightspeed-customers.mjs            # live run
 *   node scripts/import-lightspeed-customers.mjs --dry-run  # preview only, no DB writes
 */

import dotenv from 'dotenv'; dotenv.config();
import mysql  from 'mysql2/promise';
import fs     from 'fs';
import path   from 'path';

const DRY_RUN     = process.argv.includes('--dry-run');
const BATCH_SIZE  = 500;
const SAGE_DB     = 'readyedu_SageIMS';
const CSV_DIR     = path.join(process.cwd(), 'customers');

// ── CSV parser (handles quoted fields + embedded commas) ───────────────────────
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseAllCsvs() {
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv')).sort();
  if (!files.length) throw new Error(`No CSV files found in ${CSV_DIR}`);

  const seen   = new Map();   // customer_code → row object (first occurrence wins)
  let total = 0;
  let dupes = 0;

  for (const file of files) {
    const raw  = fs.readFileSync(path.join(CSV_DIR, file), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvLine(lines[i]);
      if (vals.length < 5) continue;   // skip blank/malformed lines
      const row = {};
      headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
      total++;

      const code = row.customer_code?.trim();
      if (!code) continue;   // skip rows with no customer_code

      if (seen.has(code)) { dupes++; continue; }
      seen.set(code, row);
    }
  }

  console.log(`Parsed ${files.length} file(s): ${total} rows, ${seen.size} unique customer_codes, ${dupes} duplicates skipped`);
  return [...seen.values()];
}

// ── Field mapping ───────────────────────────────────────────────────────────────
function mapRow(row, businessId) {
  const fn = (row.first_name ?? '').trim();
  const ln = (row.last_name  ?? '').trim();
  const co = (row.company_name ?? '').trim();
  const displayName = [fn, ln].filter(Boolean).join(' ') || co || row.customer_code;

  // Coerce numeric fields
  const storeCredit    = parseFloat(row.store_credit_balance)   || 0;
  const onAcct         = parseFloat(row.on_account_limit)       || null;
  const promoEmail     = row.enable_promotional_emails === '1' ? 1 : 0;
  const promoSms       = row.enable_promotional_sms   === '1' ? 1 : 0;

  // Address: use shipping fields as the single address
  const street         = (row.shipping_address_street_address  ?? '').trim() || null;
  const apt            = (row['shipping_address_apt_suite_etc.'] ?? '').trim() || null;
  const suburb         = (row.shipping_address_suburb           ?? '').trim() || null;
  // Use suburb as city fallback for Australian addresses where city is often blank
  const city           = (row.shipping_address_city             ?? '').trim() || suburb || null;
  const postcode       = (row.shipping_address_postcode_zip_code ?? '').trim() || null;
  const state          = (row.shipping_address_province_state   ?? '').trim() || null;
  // Normalise country: AU → Australia
  const rawCountry     = (row.shipping_address_country ?? '').trim();
  const country        = rawCountry === 'AU' ? 'Australia' : rawCountry || 'Australia';

  // Date of birth: only keep if it looks like a valid date
  const dob = (row.date_of_birth ?? '').trim();
  const dobVal = dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : null;

  // Gender: normalise to M / F / X
  const genderRaw = (row.gender ?? '').trim().toUpperCase();
  const gender    = ['M', 'F', 'X'].includes(genderRaw) ? genderRaw : null;

  // Customer group: strip any leftover quote artefacts, skip generic "All Customers"
  const groupRaw  = (row.customer_group_name ?? '').replace(/^["']|["']$/g, '').trim();
  const group     = groupRaw && groupRaw !== 'All Customers' ? groupRaw : null;

  return {
    business_id:   businessId,
    type:          'retail_customer',
    name:          displayName,
    first_name:    fn || null,
    last_name:     ln || null,
    company:       co || null,
    customer_code: (row.customer_code ?? '').trim(),
    customer_group: group,
    email:         (row.email ?? '').trim() || null,
    mobile:        (row.mobile_number ?? '').trim() || null,
    phone:         (row.phone_number  ?? '').trim() || null,
    address:       street,
    address2:      apt,
    suburb:        suburb,
    city:          city,
    state:         state,
    postcode:      postcode,
    country:       country,
    notes:         (row.notes ?? '').trim() || null,
    is_active:     1,
    store_credit:  storeCredit,
    on_account_limit: onAcct,
    date_of_birth: dobVal,
    gender:        gender,
    promo_email:   promoEmail,
    promo_sms:     promoSms,
    // Supplier defaults (required by table constraints)
    price_tier:            'retail',
    order_frequency_days:  45,
    charges_tax:           1,
    prices_include_tax:    0,
  };
}

// ── DB helpers ─────────────────────────────────────────────────────────────────
async function ensureColumns(conn) {
  // Check which columns already exist
  const [colRows] = await conn.execute('SHOW COLUMNS FROM ims_contacts');
  const existing = new Set(colRows.map(c => c.Field));

  const newCols = [
    ['first_name',       'VARCHAR(100) DEFAULT NULL'],
    ['last_name',        'VARCHAR(100) DEFAULT NULL'],
    ['customer_code',    'VARCHAR(100) DEFAULT NULL'],
    ['customer_group',   'VARCHAR(100) DEFAULT NULL'],
    ['mobile',           'VARCHAR(50) DEFAULT NULL'],
    ['address2',         'VARCHAR(255) DEFAULT NULL'],
    ['suburb',           'VARCHAR(100) DEFAULT NULL'],
    ['store_credit',     'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['on_account_limit', 'DECIMAL(10,2) DEFAULT NULL'],
    ['date_of_birth',    'DATE DEFAULT NULL'],
    ['gender',           'VARCHAR(10) DEFAULT NULL'],
    ['promo_email',      'TINYINT(1) NOT NULL DEFAULT 0'],
    ['promo_sms',        'TINYINT(1) NOT NULL DEFAULT 0'],
    // Supplier columns that may not exist on older Sage schema
    ['price_tier',       "VARCHAR(20) DEFAULT 'retail'"],
    ['charges_tax',      'TINYINT(1) NOT NULL DEFAULT 1'],
    ['prices_include_tax','TINYINT(1) NOT NULL DEFAULT 0'],
    ['tax_rate',         'DECIMAL(6,4) DEFAULT NULL'],
    ['website_url',      'VARCHAR(500) DEFAULT NULL'],
    ['cin7_supplier_id', 'INT DEFAULT NULL'],
    ['cin7_customer_id', 'INT DEFAULT NULL'],
  ];

  for (const [col, def] of newCols) {
    if (!existing.has(col)) {
      await conn.execute(`ALTER TABLE ims_contacts ADD COLUMN ${col} ${def}`);
      console.log(`  + Added column: ${col}`);
    }
  }

  // Expand ENUM to include new contact types (catches silently if already expanded)
  await conn.execute(
    `ALTER TABLE ims_contacts MODIFY COLUMN type ENUM('supplier','customer','b2b_customer','retail_customer','lead','both') NOT NULL DEFAULT 'supplier'`
  ).catch(() => {});

  // Unique index on customer_code — silently ignore if already exists
  await conn.execute(
    `ALTER TABLE ims_contacts ADD UNIQUE INDEX idx_customer_code (business_id, customer_code)`
  ).catch(() => {});

  console.log('Schema check done.');
}

async function getOrDetectBusinessId(mainConn) {
  // Look up which business maps to the Sage IMS database
  const [rows] = await mainConn.execute(
    `SELECT business_id FROM businesses WHERE ims_db_name = ? LIMIT 1`,
    [SAGE_DB]
  );
  if (!rows[0]) throw new Error(`No business found with ims_db_name = '${SAGE_DB}'. Check businesses table.`);
  return rows[0].business_id;
}

async function insertBatch(conn, rows) {
  if (!rows.length) return 0;

  const cols = [
    'business_id','type','name','first_name','last_name','company',
    'customer_code','customer_group',
    'email','mobile','phone',
    'address','address2','suburb','city','state','postcode','country',
    'notes','is_active',
    'store_credit','on_account_limit','date_of_birth','gender','promo_email','promo_sms',
    'price_tier','order_frequency_days','charges_tax','prices_include_tax',
  ];

  const updateCols = cols.filter(c => c !== 'business_id' && c !== 'customer_code');
  const onDup = updateCols.map(c => `${c} = VALUES(${c})`).join(', ');

  const placeholders = rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',\n  ');
  const values = rows.flatMap(r => cols.map(c => r[c] ?? null));

  const sql = `INSERT INTO ims_contacts (${cols.join(',')}) VALUES\n  ${placeholders}\nON DUPLICATE KEY UPDATE ${onDup}`;
  const [result] = await conn.execute(sql, values);
  // insertId rows: affectedRows counts 1 for insert, 2 for update, 0 for no-change
  return result.affectedRows;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const rows = parseAllCsvs();
if (!rows.length) { console.error('No rows to import.'); process.exit(1); }

if (DRY_RUN) {
  console.log(`\n[DRY RUN] Would import ${rows.length} customers into ${SAGE_DB}.`);
  // Show a sample
  const sample = rows.slice(0, 3);
  for (const r of sample) {
    const m = mapRow(r, '__preview__');
    console.log(JSON.stringify(m, null, 2));
  }
  process.exit(0);
}

// Connect to main DB to resolve business_id
const mainConn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT ?? '3306'),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE ?? 'readyedu_Solvantis',
});
const businessId = await getOrDetectBusinessId(mainConn);
console.log(`Sage business_id: ${businessId}`);
await mainConn.end();

// Connect to Sage IMS database
const imsConn = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT ?? '3306'),
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: SAGE_DB,
});

await ensureColumns(imsConn);

const mapped = rows.map(r => mapRow(r, businessId));

let totalAffected = 0;
let batchNum = 0;
for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
  batchNum++;
  const batch = mapped.slice(i, i + BATCH_SIZE);
  const affected = await insertBatch(imsConn, batch);
  totalAffected += affected;
  const from = i + 1;
  const to   = Math.min(i + BATCH_SIZE, mapped.length);
  process.stdout.write(`  Batch ${batchNum}: rows ${from}…${to} → ${affected} affected (total so far: ${totalAffected})\n`);
}

await imsConn.end();

console.log(`\nDone. ${mapped.length} customers processed, ${totalAffected} rows affected in ${SAGE_DB}.`);
if (totalAffected < mapped.length) {
  console.log(`  (${mapped.length - totalAffected} rows were unchanged — already up to date)`);
}
