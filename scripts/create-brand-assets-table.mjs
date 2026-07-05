/**
 * Create brand_assets table to store AI-generated creative prompts and templates.
 * Usage: node scripts/create-brand-assets-table.mjs
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

await c.execute(`
  CREATE TABLE IF NOT EXISTS brand_assets (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    business_id VARCHAR(255) NOT NULL,
    category    VARCHAR(50)  NOT NULL,
    name        VARCHAR(200) NOT NULL,
    content     TEXT         NOT NULL,
    notes       TEXT,
    is_active   TINYINT(1)   DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_biz_cat (business_id, category)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✓ brand_assets table ready.');
await c.end();
