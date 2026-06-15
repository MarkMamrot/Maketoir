/**
 * setup-xero-tables.mjs
 * Creates the Xero integration tables (account mappings, tracking mappings, sync log).
 * Run: node scripts/setup-xero-tables.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.MYSQL_HOST,
    port:     Number(process.env.MYSQL_PORT || 3306),
    user:     process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
  });

  console.log('Connected to', process.env.MYSQL_DATABASE);

  const sql = readFileSync(join(__dirname, 'setup-xero-tables.sql'), 'utf8');
  await conn.query(sql);

  console.log('✔ xero_account_mappings created');
  console.log('✔ xero_tracking_mappings created');
  console.log('✔ xero_sync_log created');

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
