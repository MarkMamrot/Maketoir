import mysql from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createImsDatabase } from '../../provisionBusiness';
import { consumeFifoCostLayers } from '../fifoCostingService';

const runIntegration = process.env.RUN_FIFO_MYSQL_INTEGRATION === '1';
const businessId = 'fifo-integration-business';
const state = { method: 'fifo' as const, epochId: 1, revision: 2 };
let databaseName = '';

function serverConfig(database?: string) {
  return {
    host: process.env.IMS_MYSQL_HOST ?? process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database,
  };
}

async function seedPosition(connection: mysql.Connection) {
  await connection.execute(
    `INSERT INTO ims_inventory_cost_epochs
      (id, business_id, method, status, operation_key, request_hash, opening_quantity,
       opening_value, switch_reason)
     VALUES (1, ?, 'fifo', 'active', 'integration-epoch', ?, 5, 50, 'Integration test')`,
    [businessId, 'a'.repeat(64)],
  );
  await connection.execute(
    `INSERT INTO ims_inventory_cost_state
      (business_id, active_method, active_epoch_id, revision)
     VALUES (?, 'fifo', 1, 2)`,
    [businessId],
  );
  for (const [id, quantity] of [[101, -4], [102, -3]]) {
    await connection.execute(
      `INSERT INTO ims_stock_movements
        (id, business_id, variant_id, location_id, movement_type, reference_type,
         reference_id, qty_change, qty_after_soh, unit_cost, cost_method_snapshot, cost_epoch_id)
       VALUES (?, ?, 'variant-1', 1, 'adjustment', 'manual', ?, ?, 0, NULL, 'fifo', 1)`,
      [id, businessId, id, quantity],
    );
  }
  await connection.execute(
    `INSERT INTO ims_fifo_cost_layers
      (id, business_id, epoch_id, variant_id, location_id, source_type, fifo_date,
       original_quantity, remaining_quantity, unit_cost)
     VALUES (201, ?, 1, 'variant-1', 1, 'integration_opening', '2026-01-01', 5, 5, 10)`,
    [businessId],
  );
}

describe.runIf(runIntegration)('FIFO costing MySQL integration', () => {
  beforeAll(async () => {
    databaseName = `marketoir_fifo_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createImsDatabase(databaseName);
  }, 60_000);

  beforeEach(async () => {
    const connection = await mysql.createConnection(serverConfig(databaseName));
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query('TRUNCATE TABLE ims_fifo_cost_allocations');
      await connection.query('TRUNCATE TABLE ims_fifo_cost_layers');
      await connection.query('TRUNCATE TABLE ims_inventory_cost_state');
      await connection.query('TRUNCATE TABLE ims_inventory_cost_epochs');
      await connection.query('TRUNCATE TABLE ims_stock_movements');
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      await seedPosition(connection);
    } finally {
      await connection.end();
    }
  });

  afterAll(async () => {
    if (!databaseName) return;
    const connection = await mysql.createConnection(serverConfig());
    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await connection.end();
    }
  });

  it('serializes concurrent consumers and never overspends a layer', async () => {
    const firstConnection = await mysql.createConnection(serverConfig(databaseName));
    const secondConnection = await mysql.createConnection(serverConfig(databaseName));
    try {
      await firstConnection.beginTransaction();
      await secondConnection.beginTransaction();

      const first = await consumeFifoCostLayers(firstConnection as any, {
        businessId, state, variantId: 'variant-1', locationId: 1,
        stockMovementId: 101, quantity: 4,
      });
      expect(first.allocatedValue).toBe(40);

      const secondPromise = consumeFifoCostLayers(secondConnection as any, {
        businessId, state, variantId: 'variant-1', locationId: 1,
        stockMovementId: 102, quantity: 3,
      });
      await firstConnection.commit();

      await expect(secondPromise).rejects.toMatchObject({ code: 'FIFO_COSTING_CONFLICT' });
      await secondConnection.rollback();

      const verification = await mysql.createConnection(serverConfig(databaseName));
      try {
        const [[layer]] = await verification.query<mysql.RowDataPacket[]>(
          'SELECT remaining_quantity FROM ims_fifo_cost_layers WHERE id = 201',
        );
        const [[allocation]] = await verification.query<mysql.RowDataPacket[]>(
          'SELECT COUNT(*) AS count, SUM(quantity) AS quantity FROM ims_fifo_cost_allocations',
        );
        expect(Number(layer.remaining_quantity)).toBe(1);
        expect(Number(allocation.count)).toBe(1);
        expect(Number(allocation.quantity)).toBe(4);
      } finally {
        await verification.end();
      }
    } finally {
      await firstConnection.end();
      await secondConnection.end();
    }
  }, 15_000);

  it('rolls back layer, allocation, and movement cost changes atomically', async () => {
    const connection = await mysql.createConnection(serverConfig(databaseName));
    try {
      await connection.beginTransaction();
      await consumeFifoCostLayers(connection as any, {
        businessId, state, variantId: 'variant-1', locationId: 1,
        stockMovementId: 101, quantity: 4,
      });
      await connection.rollback();

      const [[layer]] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT remaining_quantity FROM ims_fifo_cost_layers WHERE id = 201',
      );
      const [[allocation]] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM ims_fifo_cost_allocations',
      );
      const [[movement]] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT unit_cost FROM ims_stock_movements WHERE id = 101',
      );
      expect(Number(layer.remaining_quantity)).toBe(5);
      expect(Number(allocation.count)).toBe(0);
      expect(movement.unit_cost).toBeNull();
    } finally {
      await connection.end();
    }
  });
});
