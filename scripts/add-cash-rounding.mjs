/**
 * Migration: add cash_rounding column to pos_sales
 *
 * Stores the Australian cash-rounding adjustment (nearest 5c) applied to cash
 * transactions. Positive = customer pays more (e.g. $4.99 → $5.00, adj = +0.01).
 * Negative = customer pays less (e.g. $5.03 → $5.00, adj = -0.03).
 *
 * The `total` column remains the exact item-sum; the actual cash amount received
 * is `total + cash_rounding`.
 *
 * Run once:  node scripts/add-cash-rounding.mjs
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

const conn = await mysql.createConnection({
  host:     env.MYSQL_HOST,
  port:     parseInt(env.MYSQL_PORT || '3306'),
  user:     env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.IMS_MYSQL_DATABASE,
});

const [cols] = await conn.execute(
  `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'pos_sales' AND COLUMN_NAME = 'cash_rounding'`,
  [env.IMS_MYSQL_DATABASE]
);
if (cols.length === 0) {
  await conn.execute(
    `ALTER TABLE pos_sales
     ADD COLUMN cash_rounding DECIMAL(10,2) NOT NULL DEFAULT 0
     COMMENT 'Australian cash rounding adjustment: total + cash_rounding = actual cash received'`
  );
  console.log('✅  Added cash_rounding column to pos_sales.');
} else {
  console.log('ℹ️  cash_rounding column already exists, skipping.');
}

await conn.end();
