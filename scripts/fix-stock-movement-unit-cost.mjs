/**
 * Manually patch one ims_stock_movements.unit_cost row when automatic derivation
 * is impossible (orphaned legacy rows, missing variant/stock links).
 *
 * Usage:
 *   node scripts/fix-stock-movement-unit-cost.mjs --id=293 --unit-cost=1.23         (dry run)
 *   node scripts/fix-stock-movement-unit-cost.mjs --id=293 --unit-cost=1.23 --apply (commit)
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const idArg = process.argv.find((a) => a.startsWith('--id='));
const unitCostArg = process.argv.find((a) => a.startsWith('--unit-cost='));
const APPLY = process.argv.includes('--apply');

if (!idArg || !unitCostArg) {
  console.error('Required args: --id=<movement_id> --unit-cost=<number> [--apply]');
  process.exit(1);
}

const movementId = Number(idArg.split('=')[1]);
const unitCost = Number(unitCostArg.split('=')[1]);
if (!Number.isFinite(movementId) || movementId <= 0) {
  console.error('Invalid --id value');
  process.exit(1);
}
if (!Number.isFinite(unitCost) || unitCost < 0) {
  console.error('Invalid --unit-cost value (must be >= 0)');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.IMS_MYSQL_DATABASE,
});

try {
  await conn.beginTransaction();

  const [[before]] = await conn.execute(
    `SELECT id, business_id, movement_type, reference_type, reference_id,
            variant_id, location_id, qty_change, qty_after_soh, unit_cost, created_at
       FROM ims_stock_movements
      WHERE id = ?
      FOR UPDATE`,
    [movementId],
  );

  if (!before) {
    throw new Error(`Movement id ${movementId} not found`);
  }

  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?
      WHERE id = ?`,
    [unitCost, movementId],
  );

  const [[after]] = await conn.execute(
    `SELECT id, unit_cost FROM ims_stock_movements WHERE id = ?`,
    [movementId],
  );

  console.log('Before:');
  console.table([before]);
  console.log('After:');
  console.table([after]);

  if (APPLY) {
    await conn.commit();
    console.log('APPLIED');
  } else {
    await conn.rollback();
    console.log('DRY RUN (rolled back)');
  }
} catch (err) {
  await conn.rollback();
  console.error('ABORTED:', err?.message || err);
  process.exitCode = 1;
} finally {
  await conn.end();
}
