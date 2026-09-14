import mysql from 'mysql2/promise';

import { assertFifoFixtureSnapshot, type FifoFixtureSnapshot } from '../../../src/lib/liveE2E/fifoAssertions';
import type { LiveE2EConfig } from '../../../src/lib/liveE2E/safety';

export type NegativeStockPosition = {
  variantId: string;
  locationId: number;
  quantity: number;
};

function envRequired(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Live E2E blocked: ${key} is required for FIFO verification.`);
  return value;
}

export async function verifyLiveFifoIntegrity(config: LiveE2EConfig): Promise<FifoFixtureSnapshot> {
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20_000,
  });

  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [[row]] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT state.active_method, state.active_epoch_id,
              COALESCE((
                SELECT SUM(stock.qty_on_hand)
                  FROM ${schema}.ims_stock stock
                 WHERE BINARY stock.business_id = BINARY state.business_id
                   AND stock.variant_id = ? AND stock.location_id = ?
              ), 0) AS stock_quantity,
              COALESCE((
                SELECT SUM(layer.remaining_quantity)
                  FROM ${schema}.ims_fifo_cost_layers layer
                 WHERE BINARY layer.business_id = BINARY state.business_id
                   AND layer.epoch_id = state.active_epoch_id
                   AND layer.variant_id = ? AND layer.location_id = ?
              ), 0) AS layer_quantity,
              (SELECT COUNT(*)
                 FROM ${schema}.ims_fifo_cost_layers layer
                WHERE BINARY layer.business_id = BINARY state.business_id
                  AND (layer.original_quantity <= 0 OR layer.remaining_quantity < 0
                    OR layer.remaining_quantity > layer.original_quantity + 0.0001 OR layer.unit_cost < 0)
              ) AS invalid_layer_count,
              (SELECT COUNT(*)
                 FROM ${schema}.ims_fifo_cost_layers layer
                WHERE BINARY layer.business_id = BINARY state.business_id
                  AND ROUND(layer.unit_cost, 6) = 0 AND layer.zero_cost_reason IS NULL
              ) AS unexplained_zero_cost_count,
              (SELECT COUNT(*)
                 FROM ${schema}.ims_fifo_cost_allocations allocation
                 LEFT JOIN ${schema}.ims_fifo_cost_layers layer
                   ON layer.id = allocation.layer_id AND BINARY layer.business_id = BINARY allocation.business_id
                 LEFT JOIN ${schema}.ims_stock_movements movement
                   ON movement.id = allocation.stock_movement_id AND BINARY movement.business_id = BINARY allocation.business_id
                WHERE BINARY allocation.business_id = BINARY state.business_id
                  AND (allocation.quantity <= 0 OR allocation.unit_cost < 0 OR allocation.allocated_value < 0
                    OR layer.id IS NULL OR movement.id IS NULL OR layer.epoch_id <> allocation.epoch_id
                    OR movement.cost_epoch_id <> allocation.epoch_id)
              ) AS invalid_allocation_count,
              (SELECT COUNT(*)
                 FROM ${schema}.ims_stock_movements movement
                 LEFT JOIN (
                   SELECT business_id, epoch_id, stock_movement_id,
                          SUM(quantity) AS allocated_quantity, SUM(allocated_value) AS allocated_value
                     FROM ${schema}.ims_fifo_cost_allocations
                    GROUP BY business_id, epoch_id, stock_movement_id
                 ) allocation
                   ON BINARY allocation.business_id = BINARY movement.business_id
                  AND allocation.epoch_id = movement.cost_epoch_id
                  AND allocation.stock_movement_id = movement.id
                 LEFT JOIN (
                   SELECT business_id, epoch_id, source_movement_id,
                          SUM(original_quantity) AS source_quantity,
                          SUM(original_quantity * unit_cost) AS source_value
                     FROM ${schema}.ims_fifo_cost_layers
                    WHERE source_movement_id IS NOT NULL
                    GROUP BY business_id, epoch_id, source_movement_id
                 ) source_layer
                   ON BINARY source_layer.business_id = BINARY movement.business_id
                  AND source_layer.epoch_id = movement.cost_epoch_id
                  AND source_layer.source_movement_id = movement.id
                WHERE BINARY movement.business_id = BINARY state.business_id
                  AND movement.cost_method_snapshot = 'fifo'
                  AND (movement.cost_epoch_id IS NULL
                    OR ABS(ABS(movement.qty_change) - COALESCE(allocation.allocated_quantity, source_layer.source_quantity, 0)) > 0.0001
                    OR (ABS(movement.qty_change) > 0.0001 AND movement.unit_cost IS NULL)
                    OR (ABS(movement.qty_change) > 0.0001
                      AND ABS(ABS(movement.qty_change) * movement.unit_cost
                        - COALESCE(allocation.allocated_value, source_layer.source_value, 0)) > 0.01))
              ) AS movement_coverage_mismatch_count
         FROM ${schema}.ims_inventory_cost_state state
        WHERE BINARY state.business_id = BINARY ?
        LIMIT 1`,
      [config.fixtureVariantId, config.fixtureLocationId, config.fixtureVariantId, config.fixtureLocationId, config.expectedBusinessId],
    );
    if (!row) throw new Error('Live E2E blocked: inventory costing state is missing.');

    const snapshot: FifoFixtureSnapshot = {
      method: String(row.active_method) as FifoFixtureSnapshot['method'],
      activeEpochId: row.active_epoch_id == null ? null : Number(row.active_epoch_id),
      stockQuantity: Number(row.stock_quantity),
      layerQuantity: Number(row.layer_quantity),
      invalidLayerCount: Number(row.invalid_layer_count),
      unexplainedZeroCostCount: Number(row.unexplained_zero_cost_count),
      invalidAllocationCount: Number(row.invalid_allocation_count),
      movementCoverageMismatchCount: Number(row.movement_coverage_mismatch_count),
    };
    assertFifoFixtureSnapshot(snapshot);
    return snapshot;
  } finally {
    await connection.end();
  }
}

export async function loadNegativeStockPositions(config: LiveE2EConfig): Promise<NegativeStockPosition[]> {
  const connection = await mysql.createConnection({
    host: envRequired('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: envRequired('MYSQL_DATABASE'),
    user: envRequired('MYSQL_USER'),
    password: envRequired('MYSQL_PASSWORD'),
    connectTimeout: 20_000,
  });
  try {
    const schema = connection.escapeId(config.expectedImsSchema);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT stock.variant_id, stock.location_id, stock.qty_on_hand
         FROM ${schema}.ims_stock stock
         JOIN ${schema}.ims_product_variants variant
           ON variant.business_id = stock.business_id AND variant.variant_id = stock.variant_id
         JOIN ${schema}.ims_locations location
           ON location.business_id = stock.business_id AND location.id = stock.location_id
        WHERE stock.business_id = ? AND stock.qty_on_hand < -0.00005
          AND variant.is_active = 1 AND location.is_active = 1
        ORDER BY stock.location_id, stock.variant_id`,
      [config.expectedBusinessId],
    );
    return rows.map(row => ({
      variantId: String(row.variant_id),
      locationId: Number(row.location_id),
      quantity: Number(row.qty_on_hand),
    }));
  } finally {
    await connection.end();
  }
}