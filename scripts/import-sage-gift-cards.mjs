/**
 * One-time import: load the Sage gift_card_export CSV into the IMS gift_cards table.
 *
 * Usage:
 *   node scripts/import-sage-gift-cards.mjs <path-to-csv> <target-ims-schema>
 *
 * Example:
 *   node scripts/import-sage-gift-cards.mjs "downloads/gift_card_export.csv" readyedu_SageIMS
 *
 * Rules:
 *  - Dates converted from DD/MM/YYYY H:MM  →  YYYY-MM-DD HH:MM:SS
 *  - order_id is always set to "imported" (we don't link to Shopify order UUIDs)
 *  - customer_id from CSV is preserved as-is (Shopify customer UUIDs)
 *  - initial_balance is set to NULL (unknown for imported cards)
 *  - Duplicate codes (INSERT IGNORE) are silently skipped
 */
import mysql  from 'mysql2/promise';
import fs     from 'fs';
import path   from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const csvPath   = process.argv[2];
const schema    = process.argv[3];

if (!csvPath || !schema) {
  console.error('Usage: node scripts/import-sage-gift-cards.mjs <csv-path> <ims-schema>');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

// ── Date conversion ──────────────────────────────────────────────────────────
// Sage format: "22/11/2025 2:36"  (D/MM/YYYY H:MM, no leading zeros guaranteed)
function parseSageDate(str) {
  if (!str || !str.trim()) return null;
  const [datePart, timePart = '0:00'] = str.trim().split(' ');
  const [day, month, year] = datePart.split('/');
  const [hours, minutes]   = timePart.split(':');
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')} ${hours.padStart(2,'0')}:${(minutes ?? '00').padStart(2,'0')}:00`;
}

// ── CSV parser (handles quoted fields) ──────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(cur); cur = ''; }
      else cur += ch;
    }
    values.push(cur);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (values[idx] ?? '').trim(); });
    rows.push(obj);
  }
  return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

try {
  const text  = fs.readFileSync(csvPath, 'utf8');
  const rows  = parseCsv(text);
  console.log(`Parsed ${rows.length} rows from CSV.`);

  // Verify table exists
  const [tables] = await conn.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'gift_cards'`,
    [schema],
  );
  if (!tables.length) {
    console.error(`gift_cards table not found in schema "${schema}". Run scripts/add-gift-cards-table.mjs first.`);
    process.exit(1);
  }

  let inserted = 0, skipped = 0;
  const errors = [];

  for (const row of rows) {
    const code = (row['Code'] ?? '').trim();
    if (!code) { skipped++; continue; }

    const balance     = parseFloat(row['Balance'] ?? '0') || 0;
    const status      = (row['Status'] ?? 'active').toLowerCase();
    const customerId  = (row['Customer ID']     ?? '').trim() || null;
    const locationId  = (row['Location ID']     ?? '').trim() || null;
    const email       = (row['Last recipient email'] ?? '').trim() || null;
    const createdAt   = parseSageDate(row['Created at']);
    const lastUsedAt  = parseSageDate(row['Last used']);

    // Valid statuses: active, redeemed, cancelled, expired
    const safeStatus = ['active','redeemed','cancelled','expired'].includes(status) ? status : 'active';

    try {
      const [result] = await conn.execute(
        `INSERT IGNORE INTO \`${schema}\`.gift_cards
           (code, initial_balance, balance, status, customer_id, order_id,
            shopify_location_id, recipient_email, created_at, last_used_at)
         VALUES (?, NULL, ?, ?, ?, 'imported', ?, ?, ?, ?)`,
        [code, balance, safeStatus, customerId, locationId, email, createdAt, lastUsedAt],
      );
      if (result.affectedRows > 0) inserted++;
      else skipped++;  // duplicate code
    } catch (err) {
      errors.push(`${code}: ${err.message}`);
    }
  }

  console.log(`\n✓ Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates / empty): ${skipped}`);
  if (errors.length) {
    console.log(`  Errors (${errors.length}):`);
    errors.forEach(e => console.log(`    – ${e}`));
  }
} finally {
  await conn.end();
}
