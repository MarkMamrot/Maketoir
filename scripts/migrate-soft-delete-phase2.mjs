// scripts/migrate-soft-delete-phase2.mjs
// Phase 2: Add deleted_at to all data tables.
// ⚠️  Run this ONLY after the final production Cin7 sync is complete
//     and Cin7 has been disconnected. After this point Solvantis owns all data.
// Usage: node scripts/migrate-soft-delete-phase2.mjs

import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     ?? 'localhost',
  port:     parseInt(process.env.MYSQL_PORT ?? '3306', 10),
  database: process.env.MYSQL_DATABASE ?? '',
  user:     process.env.MYSQL_USER     ?? '',
  password: process.env.MYSQL_PASSWORD ?? '',
});

console.log('Connected. Running Phase 2 soft-delete migrations...');
console.log('NOTE: These tables are now source-of-truth — soft deletes protect against accidental data loss.\n');

const tables = [
  'sales',
  'products',
  'stock',
  'branches',
  'suppliers',
  'shopify_products',
  'shopify_orders',
  'chats',
  'bulk_edit_history',
  'order_planner_drafts',
  'marketing_data',
  'calc_reports',
  'yearly_revenue',
];

for (const table of tables) {
  try {
    await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN deleted_at DATETIME DEFAULT NULL`);
    console.log(`✓ Added deleted_at to ${table}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log(`— deleted_at already exists on ${table}, skipping`);
    } else if (e.code === 'ER_NO_SUCH_TABLE') {
      console.log(`— ${table} table does not exist, skipping`);
    } else {
      throw e;
    }
  }
}

await conn.end();
console.log('\nPhase 2 done. Remember to update all queries in the codebase to add WHERE deleted_at IS NULL.');
