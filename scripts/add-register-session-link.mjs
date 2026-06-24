/**
 * Migration: link each sale to the specific register SESSION it was rung up under
 * (not just a calendar date). Fixes cross-day / midnight-rollover reconciliation:
 * expected cash is then summed by session window, so a shift that crosses midnight
 * (or a register left open overnight) reconciles to the session it belongs to.
 *
 * - pos_sales.register_session_id → which open register session the sale belongs to
 * - pos_eod_reconciliations.register_session_id → informational link for reporting
 *   (the unique key is intentionally left unchanged to avoid NULL-in-unique-key
 *    semantics breaking the existing ON DUPLICATE KEY UPDATE path)
 *
 * Safe to re-run (checks before each ALTER).
 * Run with: node scripts/add-register-session-link.mjs
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
  console.log('=== Register-session linkage migration ===\n');

  // 1. pos_sales.register_session_id
  const [sCols] = await conn.query("SHOW COLUMNS FROM pos_sales LIKE 'register_session_id'");
  if (!sCols.length) {
    await conn.query('ALTER TABLE pos_sales ADD COLUMN register_session_id INT NULL AFTER register_id');
    await conn.query('ALTER TABLE pos_sales ADD INDEX idx_ps_session (register_session_id)');
    console.log('✓ Added pos_sales.register_session_id');
  } else {
    console.log('  pos_sales.register_session_id already exists');
  }

  // 2. pos_eod_reconciliations.register_session_id (informational link only)
  const [eCols] = await conn.query("SHOW COLUMNS FROM pos_eod_reconciliations LIKE 'register_session_id'");
  if (!eCols.length) {
    await conn.query('ALTER TABLE pos_eod_reconciliations ADD COLUMN register_session_id INT NULL AFTER register_id');
    console.log('✓ Added pos_eod_reconciliations.register_session_id');
  } else {
    console.log('  pos_eod_reconciliations.register_session_id already exists');
  }

  console.log('\n✅  Migration complete.\n');
}

run()
  .catch(err => { console.error('✗  Migration failed:', err.message); process.exitCode = 1; })
  .finally(() => conn.end());
