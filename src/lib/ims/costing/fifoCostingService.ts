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