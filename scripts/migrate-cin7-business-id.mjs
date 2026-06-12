/**
 * Migrate Cin7 cache tables from old inventory sheet ID to the canonical business ID.
 * Run once: node scripts/migrate-cin7-business-id.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     ?? 'localhost',
  port:     Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE ?? '',
  user:     process.env.MYSQL_USER     ?? '',
  password: process.env.MYSQL_PASSWORD ?? '',
});

// Resolve old → new from the config table
const [[cfg]] = await conn.execute(
  'SELECT business_id, value FROM config WHERE `key` = ?',
  ['Inventory System'],
);

if (!cfg) {
  console.log('No "Inventory System" config entry found — nothing to migrate.');
  await conn.end();
  process.exit(0);
}

const newId = cfg.business_id;   // canonical ID  (1wzuBk0M…)
const oldId = cfg.value;         // inventory ID  (1lKZAnxV…)

if (newId === oldId) {
  console.log('IDs already match — nothing to migrate.');
  await conn.end();
  process.exit(0);
}

console.log(`Migrating: ${oldId} → ${newId}`);

const tables = ['products', 'sales', 'branches', 'suppliers', 'stock'];

for (const table of tables) {
  const [res] = await conn.execute(
    `UPDATE \`${table}\` SET business_id = ? WHERE business_id = ?`,
    [newId, oldId],
  );
  console.log(`  ${table}: ${res.affectedRows} rows updated`);
}

// Remove the now-redundant config entry
const [del] = await conn.execute(
  'DELETE FROM config WHERE `key` = ? AND business_id = ?',
  ['Inventory System', newId],
);
console.log(`  config: ${del.affectedRows} "Inventory System" entry removed`);

console.log('\nDone. All Cin7 tables now use the canonical business ID.');
await conn.end();
