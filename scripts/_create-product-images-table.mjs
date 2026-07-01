import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']/, '').replace(/["']$/, '')]; })
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST, port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.IMS_MYSQL_DATABASE,
  connectTimeout: 20000,
});

await conn.execute(`
  CREATE TABLE IF NOT EXISTS ims_product_images (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    product_id    VARCHAR(36)  NOT NULL,
    url           TEXT         NOT NULL,
    source        ENUM('shopify','google_drive','external') NOT NULL DEFAULT 'external',
    drive_file_id VARCHAR(200) NULL,
    is_primary    TINYINT(1)   NOT NULL DEFAULT 0,
    sort_order    INT          NOT NULL DEFAULT 0,
    alt_text      VARCHAR(255) NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pi_product (product_id),
    INDEX idx_pi_primary (product_id, is_primary)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);
console.log('✅  ims_product_images table created (or already exists).');

await conn.end();
