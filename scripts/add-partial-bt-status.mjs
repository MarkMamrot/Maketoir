/**
 * Migration: add 'partial' to ims_branch_transfers.status ENUM
 * Run: node scripts/add-partial-bt-status.mjs
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config();

const conn = await createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

await conn.execute(`
  ALTER TABLE ims_branch_transfers
  MODIFY COLUMN status
    ENUM('draft','sent','partial','received','cancelled')
    NOT NULL DEFAULT 'draft'
`);

console.log("Added 'partial' to ims_branch_transfers.status ENUM");
await conn.end();
