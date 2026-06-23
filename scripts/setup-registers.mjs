/**
 * Phase 1 migration: Multi-register support
 * - Creates pos_registers and pos_register_sessions tables
 * - Adds register_id to pos_sales and pos_eod_reconciliations
 * - Auto-creates "Default Register" for each existing location
 * - Backfills register_id on existing rows
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host:     process.env.IMS_MYSQL_HOST || process.env.MYSQL_HOST,
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
  multipleStatements: true,
});

async function run() {
  console.log('=== POS Multi-Register Migration ===\n');

  // 1. pos_registers
  const [regTables] = await conn.query("SHOW TABLES LIKE 'pos_registers'");
  if (!regTables.length) {
    await conn.query(`
      CREATE TABLE pos_registers (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        location_id   INT NOT NULL,
        name          VARCHAR(100) NOT NULL DEFAULT 'Default Register',
        default_float DECIMAL(12,2) NOT NULL DEFAULT 200.00,
        is_active     TINYINT(1) NOT NULL DEFAULT 1,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (location_id) REFERENCES ims_locations(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ Created pos_registers');
  } else {
    console.log('  pos_registers already exists');
  }

  // 2. pos_register_sessions
  const [sesTables] = await conn.query("SHOW TABLES LIKE 'pos_register_sessions'");
  if (!sesTables.length) {
    await conn.query(`
      CREATE TABLE pos_register_sessions (
        id               INT AUTO_INCREMENT PRIMARY KEY,
        register_id      INT NOT NULL,
        location_id      INT NOT NULL,
        session_date     DATE NOT NULL,
        opened_at        DATETIME NOT NULL,
        closed_at        DATETIME NULL,
        opened_by        VARCHAR(255) NULL,
        closed_by        VARCHAR(255) NULL,
        opening_float    DECIMAL(12,2) NULL,
        denomination_data JSON NULL,
        status           ENUM('open','closed') NOT NULL DEFAULT 'open',
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (register_id) REFERENCES pos_registers(id),
        FOREIGN KEY (location_id) REFERENCES ims_locations(id),
        INDEX idx_prs_register (register_id, session_date),
        INDEX idx_prs_status   (register_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ Created pos_register_sessions');
  } else {
    console.log('  pos_register_sessions already exists');
  }

  // 3. Add register_id to pos_sales
  const [sCols] = await conn.query("SHOW COLUMNS FROM pos_sales LIKE 'register_id'");
  if (!sCols.length) {
    await conn.query('ALTER TABLE pos_sales ADD COLUMN register_id INT NULL AFTER location_id');
    await conn.query('ALTER TABLE pos_sales ADD INDEX idx_ps_register (register_id)');
    console.log('✓ Added pos_sales.register_id');
  } else {
    console.log('  pos_sales.register_id already exists');
  }

  // 4. Add register_id to pos_eod_reconciliations + update unique key
  const [eCols] = await conn.query("SHOW COLUMNS FROM pos_eod_reconciliations LIKE 'register_id'");
  if (!eCols.length) {
    // Drop old unique key, add register_id, add new unique key
    await conn.query('ALTER TABLE pos_eod_reconciliations DROP INDEX uq_eod');
    await conn.query('ALTER TABLE pos_eod_reconciliations ADD COLUMN register_id INT NULL AFTER location_id');
    await conn.query(`
      ALTER TABLE pos_eod_reconciliations
        ADD UNIQUE KEY uq_eod (location_id, register_id, recon_date, payment_method)
    `);
    console.log('✓ Added pos_eod_reconciliations.register_id + updated unique key');
  } else {
    console.log('  pos_eod_reconciliations.register_id already exists');
  }

  // 5. Auto-create "Default Register" for each location that doesn't have one
  const [locs] = await conn.query('SELECT id, name FROM ims_locations ORDER BY id');
  let created = 0;
  for (const loc of locs) {
    const [existing] = await conn.query(
      "SELECT id FROM pos_registers WHERE location_id = ? AND name = 'Default Register' LIMIT 1",
      [loc.id],
    );
    if (!existing.length) {
      await conn.query(
        "INSERT INTO pos_registers (location_id, name, default_float, is_active) VALUES (?, 'Default Register', 200.00, 1)",
        [loc.id],
      );
      created++;
    }
  }
  console.log(`✓ Created ${created} default register(s) for ${locs.length} location(s)`);

  // 6. Backfill register_id on existing pos_sales
  const [salesNullCount] = await conn.query('SELECT COUNT(*) AS n FROM pos_sales WHERE register_id IS NULL');
  if (salesNullCount[0].n > 0) {
    await conn.query(`
      UPDATE pos_sales s
      JOIN pos_registers r ON r.location_id = s.location_id AND r.name = 'Default Register'
      SET s.register_id = r.id
      WHERE s.register_id IS NULL
    `);
    console.log(`✓ Backfilled register_id on ${salesNullCount[0].n} pos_sales rows`);
  } else {
    console.log('  pos_sales backfill: no nulls');
  }

  // 7. Backfill register_id on existing pos_eod_reconciliations
  const [eodNullCount] = await conn.query('SELECT COUNT(*) AS n FROM pos_eod_reconciliations WHERE register_id IS NULL');
  if (eodNullCount[0].n > 0) {
    await conn.query(`
      UPDATE pos_eod_reconciliations e
      JOIN pos_registers r ON r.location_id = e.location_id AND r.name = 'Default Register'
      SET e.register_id = r.id
      WHERE e.register_id IS NULL
    `);
    console.log(`✓ Backfilled register_id on ${eodNullCount[0].n} pos_eod_reconciliations rows`);
  } else {
    console.log('  pos_eod_reconciliations backfill: no nulls');
  }

  console.log('\n✅ Migration complete.');
}

await run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
await conn.end();
