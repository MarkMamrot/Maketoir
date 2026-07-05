/**
 * Creates the creative_summaries table in the main DB.
 * Run: node scripts/create-creative-summaries-table.mjs
 */
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl:      { rejectUnauthorized: false },
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS creative_summaries (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    business_id     VARCHAR(255) NOT NULL,
    summary         TEXT,
    pending_buffer  TEXT,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_business (business_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

console.log('✓ creative_summaries table ready.');
await conn.end();
