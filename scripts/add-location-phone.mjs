/**
 * Migration: add phone column to ims_locations
 * Run once:  node scripts/add-location-phone.mjs
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

await conn.execute(
  `ALTER TABLE ims_locations
   ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NULL AFTER address`
);
console.log('✅  Added phone column to ims_locations.');

await conn.end();
