import type { PoolConnection } from 'mysql2/promise';

import {
  isInventoryCostMethod,
  planFifoConsumption,
  type InventoryCostMethod,
} from './inventoryCosting';

export type InventoryCostState = {
  method: InventoryCostMethod;
  epochId: number | null;
  revision: number;
};

export class FifoCostingConflict extends Error {
  readonly code = 'FIFO_COSTING_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'FifoCostingConflict';
  }
}

export async function lockInventoryCostState(
  conn: PoolConnection,
  businessId: string,
): Promise<InventoryCostState> {
  await conn.execute(
    `INSERT IGNORE INTO ims_inventory_cost_state (business_id, active_method)
     VALUES (?, 'average_cost')`,
    [businessId],
  );
  const [[row]] = await conn.execute<any[]>(
    `SELECT active_method, active_epoch_id, revision
       FROM ims_inventory_cost_state
      WHERE business_id = ?
      FOR UPDATE`,
    [businessId],
  );
  if (!row || !isInventoryCostMethod(row.active_method)) {
    throw new Error('Inventory costing state is missing or invalid.');
  }
  return {
    method: row.active_method,
    epochId: row.active_epoch_id == null ? null : Number(row.active_epoch_id),
    revision: Number(row.revision),
  };
}

export async function createFifoCostLayer(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    variantId: string;
    locationId: number;
    sourceType: string;
    sourceMovementId?: number | null;
    sourceReferenceType?: string | null;
    sourceReferenceId?: number | null;
    sourceLineId?: number | null;
    parentLayerId?: number | null;
    fifoDate: string | Date;
    quantity: number;
    unitCost: number;
  },
): Promise<number> {
  if (input.state.method !== 'fifo' || !input.state.epochId) {
    throw new FifoCostingConflict('FIFO cost layers can only be created while FIFO costing is active.');
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('FIFO layer quantity must be greater than zero.');
  }
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
    throw new Error('FIFO layer unit cost cannot be negative.');
  }
  const fifoDate = new Date(input.fifoDate);
  if (!Number.isFinite(fifoDate.getTime())) throw new Error('FIFO layer date is invalid.');

  const [result] = await conn.execute<any>(
    `INSERT INTO ims_fifo_cost_layers
      (business_id, epoch_id, variant_id, location_id, source_type, source_movement_id,
       source_reference_type, source_reference_id, source_line_id, parent_layer_id,
       fifo_date, original_quantity, remaining_quantity, unit_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.businessId,
      input.state.epochId,
      input.variantId,
      input.locationId,
      input.sourceType,
      input.sourceMovementId ?? null,
      input.sourceReferenceType ?? null,
      input.sourceReferenceId ?? null,
      input.sourceLineId ?? null,
      input.parentLayerId ?? null,
      fifoDate,
      input.quantity,
      input.quantity,
      input.unitCost,
    ],
  );
  return Number(result.insertId);
}

export async function consumeFifoCostLayers(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    variantId: string;
    locationId: number;
    stockMovementId: number;
    quantity: number;
  },
): Promise<{ allocatedValue: number; unitCost: number; allocationCount: number }> {
  if (input.state.method !== 'fifo' || !input.state.epochId) {
    throw new FifoCostingConflict('FIFO cost layers can only be consumed while FIFO costing is active.');
  }
  const [rows] = await conn.execute<any[]>(
    `SELECT id, fifo_date, remaining_quantity, unit_cost
       FROM ims_fifo_cost_layers
      WHERE business_id = ? AND epoch_id = ? AND variant_id = ? AND location_id = ?
        AND remaining_quantity > 0
      ORDER BY fifo_date, id
      FOR UPDATE`,
    [input.businessId, input.state.epochId, input.variantId, input.locationId],
  );
  const plan = planFifoConsumption(
    rows.map(row => ({
      layerId: Number(row.id),
      fifoDate: row.fifo_date,
      remainingQuantity: Number(row.remaining_quantity),
      unitCost: Number(row.unit_cost),
    })),
    input.quantity,
  );
  if (plan.shortageQuantity > 0) {
    throw new FifoCostingConflict(
      `Cannot complete this stock movement for variant ${input.variantId}: FIFO layers at this location cover ${plan.allocatedQuantity} units, but ${plan.requestedQuantity} are required. Reconcile the missing ${plan.shortageQuantity} units before retrying.`,
    );
  }

  for (const allocation of plan.allocations) {
    const [updateResult] = await conn.execute<any>(
      `UPDATE ims_fifo_cost_layers
          SET remaining_quantity = remaining_quantity - ?
        WHERE id = ? AND business_id = ? AND epoch_id = ? AND remaining_quantity >= ?`,
      [allocation.quantity, allocation.layerId, input.businessId, input.state.epochId, allocation.quantity],
    );
    if (Number(updateResult.affectedRows) !== 1) {
      throw new FifoCostingConflict('FIFO stock changed while this action was being completed. Refresh and try again.');
    }
    await conn.execute(
      `INSERT INTO ims_fifo_cost_allocations
        (business_id, epoch_id, stock_movement_id, layer_id, quantity, unit_cost, allocated_value, allocation_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'consume')`,
      [
        input.businessId,
        input.state.epochId,
        input.stockMovementId,
        allocation.layerId,
        allocation.quantity,
        allocation.unitCost,
        allocation.allocatedValue,
      ],
    );
  }
  const unitCost = Number(plan.weightedUnitCost ?? 0);
  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?, cost_method_snapshot = 'fifo', cost_epoch_id = ?
      WHERE id = ? AND business_id = ?`,
    [unitCost, input.state.epochId, input.stockMovementId, input.businessId],
  );
  return {
    allocatedValue: plan.allocatedValue,
    unitCost,
    allocationCount: plan.allocations.length,
  };
}