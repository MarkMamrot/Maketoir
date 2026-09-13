import type { PoolConnection } from 'mysql2/promise';

import {
  isDatabaseZeroInventoryCost,
  isInventoryCostMethod,
  planFifoConsumption,
  type InventoryCostMethod,
} from './inventoryCosting';

export type InventoryCostState = {
  method: InventoryCostMethod;
  epochId: number | null;
  revision: number;
};

export const FIFO_ZERO_COST_REASONS = [
  'supplier_no_charge',
  'build_zero_component_cost',
  'stocktake_zero_cost',
  'return_of_zero_cost_stock',
  'transfer_of_zero_cost_stock',
] as const;

export type FifoZeroCostReason = typeof FIFO_ZERO_COST_REASONS[number];

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

export async function assertFifoCatalogueDeletionAllowed(
  conn: PoolConnection,
  input: { businessId: string; variantIds: string[]; label: string },
): Promise<void> {
  const state = await lockInventoryCostState(conn, input.businessId);
  if (state.method === 'fifo') {
    throw new FifoCostingConflict(
      `${input.label} cannot be permanently deleted while FIFO costing is active. Deactivate it instead so stock valuation history remains intact.`,
    );
  }
  if (!input.variantIds.length) return;

  const placeholders = input.variantIds.map(() => '?').join(',');
  const [[row]] = await conn.execute<any[]>(
    `SELECT EXISTS(
       SELECT 1
         FROM ims_fifo_cost_layers
        WHERE business_id = ? AND variant_id IN (${placeholders})
     ) AS has_fifo_history`,
    [input.businessId, ...input.variantIds],
  );
  if (Number(row?.has_fifo_history ?? 0) === 1) {
    throw new FifoCostingConflict(
      `${input.label} cannot be permanently deleted because FIFO cost history exists. Deactivate it instead so the audit trail remains intact.`,
    );
  }
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
    zeroCostReason?: FifoZeroCostReason | null;
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
  const roundsToZeroCost = isDatabaseZeroInventoryCost(input.unitCost);
  if (roundsToZeroCost && !input.zeroCostReason) {
    throw new Error('Zero-cost FIFO layers require an auditable reason.');
  }
  if (input.zeroCostReason && !FIFO_ZERO_COST_REASONS.includes(input.zeroCostReason)) {
    throw new Error('FIFO layer zero-cost reason is invalid.');
  }
  const fifoDate = new Date(input.fifoDate);
  if (!Number.isFinite(fifoDate.getTime())) throw new Error('FIFO layer date is invalid.');

  const [result] = await conn.execute<any>(
    `INSERT INTO ims_fifo_cost_layers
      (business_id, epoch_id, variant_id, location_id, source_type, source_movement_id,
       source_reference_type, source_reference_id, source_line_id, parent_layer_id,
       fifo_date, original_quantity, remaining_quantity, unit_cost, zero_cost_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.zeroCostReason ?? null,
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
): Promise<{
  allocatedValue: number;
  unitCost: number;
  allocationCount: number;
  allocations: Array<{ layerId: number; fifoDate: string | Date; quantity: number; unitCost: number; allocatedValue: number }>;
}> {
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
    allocations: plan.allocations.map(allocation => ({
      ...allocation,
      fifoDate: rows.find(row => Number(row.id) === allocation.layerId)!.fifo_date,
    })),
  };
}

export async function reverseFifoStockMovementLayers(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    originalMovementId: number;
    reversalMovementId: number;
    expectedQuantity: number;
  },
): Promise<{ allocatedValue: number; unitCost: number; allocationCount: number }> {
  if (input.state.method !== 'fifo' || !input.state.epochId) {
    throw new FifoCostingConflict('FIFO stock movements can only be reversed while their FIFO epoch is active.');
  }
  const [[movement]] = await conn.execute<any[]>(
    `SELECT qty_change, cost_method_snapshot, cost_epoch_id
       FROM ims_stock_movements
      WHERE id = ? AND business_id = ?
      FOR UPDATE`,
    [input.originalMovementId, input.businessId],
  );
  const movementQuantity = Math.abs(Number(movement?.qty_change ?? 0));
  if (!movement
    || movement.cost_method_snapshot !== 'fifo'
    || Number(movement.cost_epoch_id) !== input.state.epochId
    || input.expectedQuantity <= 0
    || input.expectedQuantity - movementQuantity > 0.0001) {
    throw new FifoCostingConflict(
      'The original FIFO movement does not match this reversal quantity or the active valuation epoch. Complete a reviewed corrective stocktake instead.',
    );
  }

  let allocatedValue = 0;
  let allocationCount = 0;
  if (Number(movement.qty_change) < 0) {
    const [allocations] = await conn.execute<any[]>(
      `SELECT allocation.id, allocation.layer_id, allocation.quantity,
              allocation.unit_cost, allocation.allocated_value
         FROM ims_fifo_cost_allocations allocation
        WHERE allocation.business_id = ? AND allocation.epoch_id = ?
          AND allocation.stock_movement_id = ? AND allocation.allocation_type = 'consume'
        ORDER BY allocation.id
        FOR UPDATE`,
      [input.businessId, input.state.epochId, input.originalMovementId],
    );
    const totalQuantity = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity), 0);
    if (!allocations.length || Math.abs(totalQuantity - movementQuantity) > 0.0001) {
      throw new FifoCostingConflict('The original FIFO consumption allocations are incomplete and cannot be reversed automatically.');
    }
    const [priorReversals] = await conn.execute<any[]>(
      `SELECT reversal_of_allocation_id, SUM(quantity) AS reversed_quantity
         FROM ims_fifo_cost_allocations
        WHERE business_id = ? AND epoch_id = ? AND reversal_of_allocation_id IN (${allocations.map(() => '?').join(',')})
        GROUP BY reversal_of_allocation_id
        FOR UPDATE`,
      [input.businessId, input.state.epochId, ...allocations.map(allocation => Number(allocation.id))],
    );
    const reversedByAllocation = new Map(priorReversals.map(row => [
      Number(row.reversal_of_allocation_id), Number(row.reversed_quantity),
    ]));
    const remainingQuantity = allocations.reduce((sum, allocation) => (
      sum + Math.max(0, Number(allocation.quantity) - Number(reversedByAllocation.get(Number(allocation.id)) ?? 0))
    ), 0);
    if (remainingQuantity + 0.0001 < input.expectedQuantity) {
      throw new FifoCostingConflict('The requested quantity exceeds the unreversed original FIFO allocations. Refresh the document before retrying.');
    }
    let quantityToRestore = input.expectedQuantity;
    for (const allocation of allocations) {
      const available = Math.max(0, Number(allocation.quantity) - Number(reversedByAllocation.get(Number(allocation.id)) ?? 0));
      const quantity = Math.min(available, quantityToRestore);
      if (quantity <= 0.0001) continue;
      const unitCost = Number(allocation.unit_cost);
      const value = quantity * unitCost;
      const [updateResult] = await conn.execute<any>(
        `UPDATE ims_fifo_cost_layers
            SET remaining_quantity = remaining_quantity + ?
          WHERE id = ? AND business_id = ? AND epoch_id = ?
            AND remaining_quantity + ? <= original_quantity + 0.0001`,
        [quantity, allocation.layer_id, input.businessId, input.state.epochId, quantity],
      );
      if (Number(updateResult.affectedRows) !== 1) {
        throw new FifoCostingConflict('An original FIFO layer can no longer accept its reversed quantity. Reconcile its history before retrying.');
      }
      await conn.execute(
        `INSERT INTO ims_fifo_cost_allocations
          (business_id, epoch_id, stock_movement_id, layer_id, quantity, unit_cost,
           allocated_value, allocation_type, reversal_of_allocation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'restore', ?)`,
        [input.businessId, input.state.epochId, input.reversalMovementId, allocation.layer_id,
          quantity, unitCost, value, allocation.id],
      );
      allocatedValue += value;
      allocationCount++;
      quantityToRestore -= quantity;
      if (quantityToRestore <= 0.0001) break;
    }
  } else {
    const [layers] = await conn.execute<any[]>(
      `SELECT id, original_quantity, remaining_quantity, unit_cost
         FROM ims_fifo_cost_layers
        WHERE business_id = ? AND epoch_id = ? AND source_movement_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.businessId, input.state.epochId, input.originalMovementId],
    );
    const totalQuantity = layers.reduce((sum, layer) => sum + Number(layer.original_quantity), 0);
    const [priorReversals] = layers.length ? await conn.execute<any[]>(
      `SELECT layer_id, SUM(quantity) AS reversed_quantity
         FROM ims_fifo_cost_allocations
        WHERE business_id = ? AND epoch_id = ? AND layer_id IN (${layers.map(() => '?').join(',')})
          AND allocation_type = 'reverse_inbound'
        GROUP BY layer_id
        FOR UPDATE`,
      [input.businessId, input.state.epochId, ...layers.map(layer => Number(layer.id))],
    ) : [[]];
    const reversedByLayer = new Map(priorReversals.map(row => [Number(row.layer_id), Number(row.reversed_quantity)]));
    const allUnconsumed = layers.every(layer => {
      const expectedRemaining = Number(layer.original_quantity) - Number(reversedByLayer.get(Number(layer.id)) ?? 0);
      return Math.abs(Number(layer.remaining_quantity) - expectedRemaining) <= 0.0001;
    });
    const unreversedQuantity = layers.reduce((sum, layer) => (
      sum + Math.max(0, Number(layer.original_quantity) - Number(reversedByLayer.get(Number(layer.id)) ?? 0))
    ), 0);
    if (!layers.length || Math.abs(totalQuantity - movementQuantity) > 0.0001 || !allUnconsumed
      || unreversedQuantity + 0.0001 < input.expectedQuantity) {
      throw new FifoCostingConflict(
        'Stock created by the original FIFO movement has already been used or moved and cannot be reversed automatically.',
      );
    }
    let quantityToReverse = input.expectedQuantity;
    for (const layer of layers) {
      const alreadyReversed = Number(reversedByLayer.get(Number(layer.id)) ?? 0);
      const available = Math.max(0, Number(layer.original_quantity) - alreadyReversed);
      const quantity = Math.min(available, quantityToReverse);
      if (quantity <= 0.0001) continue;
      const unitCost = Number(layer.unit_cost);
      const value = quantity * unitCost;
      const [updateResult] = await conn.execute<any>(
        `UPDATE ims_fifo_cost_layers
            SET remaining_quantity = remaining_quantity - ?
          WHERE id = ? AND business_id = ? AND epoch_id = ?
            AND ABS(remaining_quantity - ?) <= 0.0001`,
        [quantity, layer.id, input.businessId, input.state.epochId, available],
      );
      if (Number(updateResult.affectedRows) !== 1) {
        throw new FifoCostingConflict('FIFO stock changed while this reversal was being completed. Refresh and try again.');
      }
      await conn.execute(
        `INSERT INTO ims_fifo_cost_allocations
          (business_id, epoch_id, stock_movement_id, layer_id, quantity, unit_cost, allocated_value, allocation_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'reverse_inbound')`,
        [input.businessId, input.state.epochId, input.reversalMovementId, layer.id, quantity, unitCost, value],
      );
      allocatedValue += value;
      allocationCount++;
      quantityToReverse -= quantity;
      if (quantityToReverse <= 0.0001) break;
    }
  }

  const unitCost = input.expectedQuantity > 0 ? allocatedValue / input.expectedQuantity : 0;
  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?, cost_method_snapshot = 'fifo', cost_epoch_id = ?
      WHERE id = ? AND business_id = ?`,
    [unitCost, input.state.epochId, input.reversalMovementId, input.businessId],
  );
  return { allocatedValue, unitCost, allocationCount };
}

export async function transferFifoCostLayers(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    variantId: string;
    sourceLocationId: number;
    destinationLocationId: number;
    outboundMovementId: number;
    inboundMovementId: number;
    transferId: number;
    transferItemId?: number | null;
    quantity: number;
  },
): Promise<{ allocatedValue: number; unitCost: number; layerCount: number }> {
  const consumption = await consumeFifoCostLayers(conn, {
    businessId: input.businessId,
    state: input.state,
    variantId: input.variantId,
    locationId: input.sourceLocationId,
    stockMovementId: input.outboundMovementId,
    quantity: input.quantity,
  });
  for (const allocation of consumption.allocations) {
    await createFifoCostLayer(conn, {
      businessId: input.businessId,
      state: input.state,
      variantId: input.variantId,
      locationId: input.destinationLocationId,
      sourceType: 'branch_transfer',
      sourceMovementId: input.inboundMovementId,
      sourceReferenceType: 'branch_transfer',
      sourceReferenceId: input.transferId,
      sourceLineId: input.transferItemId ?? null,
      parentLayerId: allocation.layerId,
      fifoDate: allocation.fifoDate,
      quantity: allocation.quantity,
      unitCost: allocation.unitCost,
      zeroCostReason: Math.round(allocation.unitCost * 1_000_000) === 0 ? 'transfer_of_zero_cost_stock' : null,
    });
  }
  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?, cost_method_snapshot = 'fifo', cost_epoch_id = ?
      WHERE id = ? AND business_id = ?`,
    [consumption.unitCost, input.state.epochId, input.inboundMovementId, input.businessId],
  );
  return {
    allocatedValue: consumption.allocatedValue,
    unitCost: consumption.unitCost,
    layerCount: consumption.allocations.length,
  };
}

export async function createFifoPosReturnLayers(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    returnPosSaleId: number;
    creditNoteId: number;
    returnMovementId: number;
    variantId: string;
    locationId: number;
    quantity: number;
    returnDate: string | Date;
  },
): Promise<{ allocatedValue: number; unitCost: number; layerCount: number }> {
  if (input.state.method !== 'fifo' || !input.state.epochId) {
    throw new FifoCostingConflict('FIFO return layers can only be created while FIFO costing is active.');
  }
  const [returnLines] = await conn.execute<any[]>(
    `SELECT sale.return_of_sale_id AS original_sale_id,
            item.return_of_sale_item_id AS original_sale_item_id,
            ABS(item.qty) AS return_quantity
       FROM pos_sales sale
       JOIN pos_sale_items item ON item.sale_id = sale.id
      WHERE sale.id = ? AND sale.business_id = ? AND sale.sale_type = 'return'
        AND item.variant_id = ? AND item.qty < 0 AND item.return_of_sale_item_id IS NOT NULL
      ORDER BY item.id
      FOR UPDATE`,
    [input.returnPosSaleId, input.businessId, input.variantId],
  );
  const linkedQuantity = returnLines.reduce((sum, row) => sum + Number(row.return_quantity), 0);
  const originalSaleIds = [...new Set(returnLines.map(row => Number(row.original_sale_id)).filter(id => id > 0))];
  if (originalSaleIds.length !== 1 || Math.abs(linkedQuantity - input.quantity) > 0.0001) {
    throw new FifoCostingConflict(
      `Cannot restock variant ${input.variantId}: the POS return is not fully linked to one original completed sale. Correct the return links before retrying.`,
    );
  }
  const originalSaleId = originalSaleIds[0];
  const [allocationRows] = await conn.execute<any[]>(
    `SELECT allocation.layer_id, SUM(allocation.quantity) AS sold_quantity,
            MAX(allocation.unit_cost) AS unit_cost, MIN(layer.fifo_date) AS fifo_date
       FROM ims_fifo_cost_allocations allocation
       JOIN ims_stock_movements movement
         ON movement.id = allocation.stock_movement_id AND movement.business_id = allocation.business_id
       JOIN ims_fifo_cost_layers layer
         ON layer.id = allocation.layer_id AND layer.business_id = allocation.business_id
      WHERE allocation.business_id = ? AND allocation.epoch_id = ?
        AND movement.movement_type = 'pos_sale' AND movement.reference_type = 'pos_sale'
        AND movement.reference_id = ? AND movement.variant_id = ? AND movement.location_id = ?
      GROUP BY allocation.layer_id
      ORDER BY MIN(layer.fifo_date), allocation.layer_id
      FOR UPDATE`,
    [input.businessId, input.state.epochId, originalSaleId, input.variantId, input.locationId],
  );
  const [restoredRows] = allocationRows.length > 0 ? await conn.execute<any[]>(
    `SELECT parent_layer_id, SUM(original_quantity) AS restored_quantity
       FROM ims_fifo_cost_layers
      WHERE business_id = ? AND epoch_id = ? AND source_type = 'pos_return'
        AND source_reference_type = 'pos_sale' AND source_reference_id = ?
        AND parent_layer_id IN (${allocationRows.map(() => '?').join(',')})
      GROUP BY parent_layer_id
      FOR UPDATE`,
    [input.businessId, input.state.epochId, originalSaleId, ...allocationRows.map(row => Number(row.layer_id))],
  ) : [[]];
  const restoredByLayer = new Map(restoredRows.map(row => [Number(row.parent_layer_id), Number(row.restored_quantity)]));
  const candidates = allocationRows.map(row => ({
    layerId: Number(row.layer_id),
    fifoDate: row.fifo_date,
    remainingQuantity: Math.max(0, Number(row.sold_quantity) - Number(restoredByLayer.get(Number(row.layer_id)) ?? 0)),
    unitCost: Number(row.unit_cost),
  }));
  const plan = planFifoConsumption(candidates, input.quantity);
  if (plan.shortageQuantity > 0) {
    throw new FifoCostingConflict(
      `Cannot restock variant ${input.variantId}: original FIFO allocations have ${plan.allocatedQuantity} returnable units, but ${plan.requestedQuantity} are required. Reconcile the missing ${plan.shortageQuantity} units before retrying.`,
    );
  }
  let lineIndex = 0;
  let lineRemaining = Number(returnLines[0]?.return_quantity ?? 0);
  for (const allocation of plan.allocations) {
    let allocationRemaining = allocation.quantity;
    while (allocationRemaining > 0) {
      const line = returnLines[lineIndex];
      if (!line) throw new FifoCostingConflict('The linked POS return quantities changed while costing was being applied.');
      const quantity = Math.min(allocationRemaining, lineRemaining);
      await createFifoCostLayer(conn, {
        businessId: input.businessId,
        state: input.state,
        variantId: input.variantId,
        locationId: input.locationId,
        sourceType: 'pos_return',
        sourceMovementId: input.returnMovementId,
        sourceReferenceType: 'pos_sale',
        sourceReferenceId: originalSaleId,
        sourceLineId: Number(line.original_sale_item_id),
        parentLayerId: allocation.layerId,
        fifoDate: input.returnDate,
        quantity,
        unitCost: allocation.unitCost,
        zeroCostReason: Math.round(allocation.unitCost * 1_000_000) === 0 ? 'return_of_zero_cost_stock' : null,
      });
      allocationRemaining -= quantity;
      lineRemaining -= quantity;
      if (lineRemaining <= 0.0001) {
        lineIndex += 1;
        lineRemaining = Number(returnLines[lineIndex]?.return_quantity ?? 0);
      }
    }
  }
  const unitCost = Number(plan.weightedUnitCost ?? 0);
  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?, cost_method_snapshot = 'fifo', cost_epoch_id = ?
      WHERE id = ? AND business_id = ?`,
    [unitCost, input.state.epochId, input.returnMovementId, input.businessId],
  );
  return { allocatedValue: plan.allocatedValue, unitCost, layerCount: plan.allocations.length };
}

export async function createFifoSalesOrderReturnLayers(
  conn: PoolConnection,
  input: {
    businessId: string;
    state: InventoryCostState;
    sourceSalesOrderItemId: number;
    creditNoteId: number;
    creditNoteItemId: number;
    returnMovementId: number;
    variantId: string;
    locationId: number;
    quantity: number;
    returnDate: string | Date;
  },
): Promise<{ allocatedValue: number; unitCost: number; layerCount: number }> {
  if (input.state.method !== 'fifo' || !input.state.epochId) {
    throw new FifoCostingConflict('FIFO return layers can only be created while FIFO costing is active.');
  }
  const [[sourceLine]] = await conn.execute<any[]>(
    `SELECT soi.so_id, soi.variant_id, so.location_id
       FROM ims_sales_order_items soi
       JOIN ims_sales_orders so ON so.id = soi.so_id
      WHERE soi.id = ? AND so.business_id = ?
      FOR UPDATE`,
    [input.sourceSalesOrderItemId, input.businessId],
  );
  if (!sourceLine || String(sourceLine.variant_id) !== input.variantId) {
    throw new FifoCostingConflict(
      `Cannot restock variant ${input.variantId}: its linked sales-order line is missing or belongs to another variant. Correct the return link before retrying.`,
    );
  }
  const [allocationRows] = await conn.execute<any[]>(
    `SELECT allocation.layer_id, SUM(allocation.quantity) AS sold_quantity,
            MAX(allocation.unit_cost) AS unit_cost, MIN(layer.fifo_date) AS fifo_date
       FROM ims_fifo_cost_allocations allocation
       JOIN ims_stock_movements movement
         ON movement.id = allocation.stock_movement_id AND movement.business_id = allocation.business_id
       JOIN ims_fifo_cost_layers layer
         ON layer.id = allocation.layer_id AND layer.business_id = allocation.business_id
      WHERE allocation.business_id = ? AND allocation.epoch_id = ?
        AND movement.movement_type = 'so_fulfilled' AND movement.reference_type = 'sales_order'
        AND movement.reference_id = ? AND movement.source_line_id = ?
        AND movement.variant_id = ? AND movement.location_id = ?
      GROUP BY allocation.layer_id
      ORDER BY MIN(layer.fifo_date), allocation.layer_id
      FOR UPDATE`,
    [input.businessId, input.state.epochId, Number(sourceLine.so_id), input.sourceSalesOrderItemId,
      input.variantId, Number(sourceLine.location_id)],
  );
  const [restoredRows] = allocationRows.length > 0 ? await conn.execute<any[]>(
    `SELECT parent_layer_id, SUM(original_quantity) AS restored_quantity
       FROM ims_fifo_cost_layers
      WHERE business_id = ? AND epoch_id = ? AND source_type = 'sales_order_return'
        AND parent_layer_id IN (${allocationRows.map(() => '?').join(',')})
      GROUP BY parent_layer_id
      FOR UPDATE`,
    [input.businessId, input.state.epochId, ...allocationRows.map(row => Number(row.layer_id))],
  ) : [[]];
  const restoredByLayer = new Map(restoredRows.map(row => [Number(row.parent_layer_id), Number(row.restored_quantity)]));
  const plan = planFifoConsumption(allocationRows.map(row => ({
    layerId: Number(row.layer_id),
    fifoDate: row.fifo_date,
    remainingQuantity: Math.max(0, Number(row.sold_quantity) - Number(restoredByLayer.get(Number(row.layer_id)) ?? 0)),
    unitCost: Number(row.unit_cost),
  })), input.quantity);
  if (plan.shortageQuantity > 0) {
    throw new FifoCostingConflict(
      `Cannot restock variant ${input.variantId}: original sales-order FIFO allocations have ${plan.allocatedQuantity} returnable units, but ${plan.requestedQuantity} are required. Reconcile the missing ${plan.shortageQuantity} units before retrying.`,
    );
  }
  for (const allocation of plan.allocations) {
    await createFifoCostLayer(conn, {
      businessId: input.businessId,
      state: input.state,
      variantId: input.variantId,
      locationId: input.locationId,
      sourceType: 'sales_order_return',
      sourceMovementId: input.returnMovementId,
      sourceReferenceType: 'credit_note',
      sourceReferenceId: input.creditNoteId,
      sourceLineId: input.creditNoteItemId,
      parentLayerId: allocation.layerId,
      fifoDate: input.returnDate,
      quantity: allocation.quantity,
      unitCost: allocation.unitCost,
      zeroCostReason: Math.round(allocation.unitCost * 1_000_000) === 0 ? 'return_of_zero_cost_stock' : null,
    });
  }
  const unitCost = Number(plan.weightedUnitCost ?? 0);
  await conn.execute(
    `UPDATE ims_stock_movements
        SET unit_cost = ?, cost_method_snapshot = 'fifo', cost_epoch_id = ?
      WHERE id = ? AND business_id = ?`,
    [unitCost, input.state.epochId, input.returnMovementId, input.businessId],
  );
  return { allocatedValue: plan.allocatedValue, unitCost, layerCount: plan.allocations.length };
}