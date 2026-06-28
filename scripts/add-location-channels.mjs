/**
 * Migration: add channel capability flags to ims_locations
 *            and channel column to ims_stock_movements
 *
 * Run: node scripts/add-location-channels.mjs
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host:           process.env.MYSQL_HOST,
  port:           parseInt(process.env.MYSQL_PORT || '3306'),
  database:       process.env.IMS_MYSQL_DATABASE,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  connectTimeout: 20000,
});

async function run() {
  try {
    // ── ims_locations: capability flags ──────────────────────────────────────
    const [locCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_locations'
         AND COLUMN_NAME IN ('has_pos','has_wholesale','has_online')`
    );
    const existingLocCols = new Set(locCols.map(r => r.COLUMN_NAME));

    if (!existingLocCols.has('has_pos')) {
      await conn.execute(`ALTER TABLE ims_locations ADD COLUMN has_pos TINYINT(1) NOT NULL DEFAULT 0`);
      console.log('✓ Added ims_locations.has_pos');
    } else { console.log('– ims_locations.has_pos already exists'); }

    if (!existingLocCols.has('has_wholesale')) {
      await conn.execute(`ALTER TABLE ims_locations ADD COLUMN has_wholesale TINYINT(1) NOT NULL DEFAULT 0`);
      console.log('✓ Added ims_locations.has_wholesale');
    } else { console.log('– ims_locations.has_wholesale already exists'); }

    if (!existingLocCols.has('has_online')) {
      await conn.execute(`ALTER TABLE ims_locations ADD COLUMN has_online TINYINT(1) NOT NULL DEFAULT 0`);
      console.log('✓ Added ims_locations.has_online');
    } else { console.log('– ims_locations.has_online already exists'); }

    // ── ims_stock_movements: channel column ───────────────────────────────────
    const [movCols] = await conn.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ims_stock_movements'
         AND COLUMN_NAME = 'channel'`
    );

    if (movCols.length === 0) {
      await conn.execute(
        `ALTER TABLE ims_stock_movements
         ADD COLUMN channel VARCHAR(20) NULL AFTER movement_type`
      );
      await conn.execute(`ALTER TABLE ims_stock_movements ADD INDEX idx_sm_channel (channel)`);
      console.log('✓ Added ims_stock_movements.channel + index');
    } else { console.log('– ims_stock_movements.channel already exists'); }

    console.log('\nMigration complete.');
  } finally {
    await conn.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
