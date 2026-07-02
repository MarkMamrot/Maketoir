/**
 * Add zeller_site_id and zeller_terminal_id columns to pos_registers.
 * Safe to re-run — uses ALTER TABLE only if the column is missing.
 *
 * Usage: node scripts/add-zeller-columns.mjs
 */
import dotenv from 'dotenv'; dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

try {
  const [cols] = await conn.execute(`SHOW COLUMNS FROM pos_registers LIKE 'zeller_%'`);
  if ((cols as any[]).length >= 2) {
    console.log('✓ Zeller columns already exist — nothing to do.');
  } else {
    await conn.execute(`
      ALTER TABLE pos_registers
        ADD COLUMN IF NOT EXISTS zeller_site_id     VARCHAR(255) NULL DEFAULT NULL AFTER default_float,
        ADD COLUMN IF NOT EXISTS zeller_terminal_id  VARCHAR(255) NULL DEFAULT NULL AFTER zeller_site_id
    `);
    console.log('✓ Added zeller_site_id and zeller_terminal_id to pos_registers.');
  }
} finally {
  await conn.end();
}
