/**
 * Creates the ims_settings table for per-business key/value settings.
 * Run: node scripts/setup-ims-settings.mjs
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_settings (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(150) NOT NULL,
    \`key\`       VARCHAR(100) NOT NULL,
    value       MEDIUMTEXT,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_biz_key (business_id, \`key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

console.log('✅ ims_settings table created (or already exists).');
await conn.end();
