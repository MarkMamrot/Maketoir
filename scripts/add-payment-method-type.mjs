/**
 * Migration: add `type` column ('po' | 'so') to ims_payment_methods
 * Run once: node scripts/add-payment-method-type.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT ?? 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  ssl:      { rejectUnauthorized: false },
});

try {
  // Check if column already exists
  const [cols] = await conn.query(
    `SHOW COLUMNS FROM ims_payment_methods WHERE Field = 'type'`
  );
  if (cols.length > 0) {
    console.log('Column `type` already exists — nothing to do.');
    process.exit(0);
  }

  console.log('Adding `type` column...');
  await conn.query(
    `ALTER TABLE ims_payment_methods
     ADD COLUMN type ENUM('po','so') NOT NULL DEFAULT 'po' AFTER name`
  );

  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ims_payment_methods`);
  console.log(`✅ Done. ${rows[0].n} existing rows defaulted to type='po'.`);
  console.log('   Add SO payment methods via Settings → Sales Orders → Payment Methods.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await conn.end();
}
