/**
 * Migration: rename PO status 'ordered' → 'confirmed'
 *
 * Run once:  node scripts/rename-po-status-ordered-to-confirmed.mjs
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
  multipleStatements: true,
});

try {
  console.log('Checking current ENUM definition...');
  const [cols] = await conn.query(
    `SHOW COLUMNS FROM ims_purchase_orders WHERE Field = 'status'`
  );
  console.log('Current:', cols[0]?.Type);

  // Count rows that need updating
  const [count] = await conn.query(
    `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE status = 'ordered'`
  );
  console.log(`Rows with status='ordered': ${count[0].n}`);

  // Step 1: Expand the ENUM to include both values temporarily
  console.log('\nStep 1: Expanding ENUM to include both values...');
  await conn.query(
    `ALTER TABLE ims_purchase_orders
     MODIFY COLUMN status ENUM('draft','ordered','confirmed','partially_received','received','cancelled') NOT NULL DEFAULT 'draft'`
  );

  // Step 2: Update existing rows
  console.log('Step 2: Updating existing rows...');
  const [upd] = await conn.query(
    `UPDATE ims_purchase_orders SET status = 'confirmed' WHERE status = 'ordered'`
  );
  console.log(`  Updated ${upd.affectedRows} rows`);

  // Step 3: Remove 'ordered' from the ENUM
  console.log('Step 3: Removing old \'ordered\' value from ENUM...');
  await conn.query(
    `ALTER TABLE ims_purchase_orders
     MODIFY COLUMN status ENUM('draft','confirmed','partially_received','received','cancelled') NOT NULL DEFAULT 'draft'`
  );

  console.log('\n✅ Migration complete. PO status \'ordered\' → \'confirmed\'');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await conn.end();
}
