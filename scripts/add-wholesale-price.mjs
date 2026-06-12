import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]/,'').replace(/['"]$/,'')]; })
);

const pool = await mysql.createPool({
  host: env.MYSQL_HOST,
  port: parseInt(env.MYSQL_PORT || '3306'),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.IMS_MYSQL_DATABASE,
});

console.log('Adding wholesale_price to ims_product_variants...');
await pool.query(`
  ALTER TABLE ims_product_variants
  ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10,4) NULL AFTER price
`);

console.log('Adding price_tier to ims_contacts...');
await pool.query(`
  ALTER TABLE ims_contacts
  ADD COLUMN IF NOT EXISTS price_tier ENUM('retail','wholesale') NOT NULL DEFAULT 'retail'
`);

console.log('Done!');
await pool.end();
