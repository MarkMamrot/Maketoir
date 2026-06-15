/**
 * Migration: PO Landed Costs
 *
 * 1. Creates ims_po_landed_costs table (label, reference, amount per PO)
 * 2. Adds landed_cost_per_unit column to ims_purchase_order_items
 * 3. Migrates existing freight values → one landed cost row per PO
 * 4. Zeroes out freight on PO headers (column kept for backwards compat)
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 3,
});

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log('Connected. Running PO landed costs migration...');

    // 1. Create landed costs table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ims_po_landed_costs (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        po_id      INT NOT NULL,
        label      VARCHAR(100) NOT NULL,
        reference  VARCHAR(100) DEFAULT NULL,
        amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
        sort_order TINYINT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_po (po_id)
      )
    `);
    console.log('✓ ims_po_landed_costs table ready');

    // 2. Add landed_cost_per_unit to items (if not already there)
    const [cols] = await conn.execute(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ims_purchase_order_items'
        AND COLUMN_NAME = 'landed_cost_per_unit'
    `);
    if (cols.length === 0) {
      await conn.execute(`
        ALTER TABLE ims_purchase_order_items
        ADD COLUMN landed_cost_per_unit DECIMAL(12,4) NOT NULL DEFAULT 0
          AFTER unit_cost
      `);
      console.log('✓ Added landed_cost_per_unit to ims_purchase_order_items');
    } else {
      console.log('✓ landed_cost_per_unit already exists');
    }

    // 3. Migrate existing freight values → landed cost rows
    const [pos] = await conn.execute(`
      SELECT id, freight FROM ims_purchase_orders
      WHERE freight IS NOT NULL AND freight > 0
    `);
    let migrated = 0;
    for (const po of pos) {
      const [existing] = await conn.execute(
        `SELECT id FROM ims_po_landed_costs WHERE po_id = ? AND label = 'Freight'`,
        [po.id]
      );
      if (existing.length === 0) {
        await conn.execute(
          `INSERT INTO ims_po_landed_costs (po_id, label, reference, amount, sort_order)
           VALUES (?, 'Freight', NULL, ?, 0)`,
          [po.id, po.freight]
        );
        migrated++;
      }
    }
    console.log(`✓ Migrated ${migrated} existing freight values to landed costs`);

    // 4. Zero out freight on all PO headers (keeping column for compat)
    await conn.execute(`UPDATE ims_purchase_orders SET freight = 0 WHERE freight IS NOT NULL AND freight > 0`);
    console.log('✓ Zeroed freight column on PO headers');

    console.log('\nDone. Run your app — landed costs are now live.');
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
