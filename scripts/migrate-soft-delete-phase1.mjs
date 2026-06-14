// scripts/migrate-soft-delete-phase1.mjs
// Phase 1: Add deleted_at to users and businesses.
// Run this NOW (before production sync).
// Usage: node scripts/migrate-soft-delete-phase1.mjs

import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     ?? 'localhost',
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.MYSQL_DATABASE ?? '',
  user:     process.env.MYSQL_USER     ?? '',
  password: process.env.MYSQL_PASSWORD ?? '',
});

console.log('Connected. Running Phase 1 soft-delete migrations...');

for (const table of ['users', 'businesses']) {
  try {
    await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN deleted_at DATETIME DEFAULT NULL`);
    console.log(`✓ Added deleted_at to ${table}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log(`— deleted_at already exists on ${table}, skipping`);
    } else {
      throw e;
    }
  }
}

await conn.end();
console.log('Phase 1 done.');
