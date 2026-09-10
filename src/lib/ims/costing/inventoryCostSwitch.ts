import { createHash } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';

import { getIMSPool } from '@/services/IMSMySQLService';
import { createFifoCostLayer, FifoCostingConflict, lockInventoryCostState } from './fifoCostingService';
import { isInventoryCostMethod, type InventoryCostMethod } from './inventoryCosting';

const QUANTITY_TOLERANCE = 0.0001;
export const INVENTORY_COST_METHOD_SETTING_KEY = 'inventory_cost_method';
export const FIFO_COSTING_ACTIVATION_READY = false;

type StockSnapshot = {
  variantId: string;
  locationId: number;
  quantity: number;
  unitCost: number | null;
};

export type InventoryCostSwitchPreview = {
  currentMethod: InventoryCostMethod;
  targetMethod: InventoryCostMethod;
  revision: number;
  stockRowCount: number;
  positiveStockRowCount: number;
  totalQuantity: number;
  totalValue: number;
  blockers: string[];
  warnings: string[];
};

export type SwitchInventoryCostMethodInput = {
  businessId: string;
  targetMethod: InventoryCostMethod;
  expectedRevision: number;
  operationKey: string;
  reason: string;
  actorId?: number | null;
  actorName?: string | null;
};

function requestHash(input: SwitchInventoryCostMethodInput): string {
  return createHash('sha256').update(JSON.stringify({
    targetMethod: input.targetMethod,
    expectedRevision: input.expectedRevision,
    reason: input.reason.trim(),
  })).digest('hex');
}

function validateSwitchInput(input: SwitchInventoryCostMethodInput): void {
  if (!input.businessId) throw new Error('Business context is required.');
  if (!isInventoryCostMethod(input.targetMethod)) throw new Error('Inventory costing method must be Average Cost or FIFO.');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) throw new Error('A valid costing revision is required.');
  if (!input.operationKey.trim() || input.operationKey.length > 191) throw new Error('A valid operation key is required.');
  if (!input.reason.trim() || input.reason.trim().length > 500) throw new Error('A switch reason of 500 characters or fewer is required.');
}

async function loadStockSnapshots(conn: PoolConnection, businessId: string, lock: boolean): Promise<StockSnapshot[]> {
  const [rows] = await conn.execute<any[]>(
    `SELECT s.variant_id, s.location_id, s.qty_on_hand,
            COALESCE(pv.avg_cost, s.avg_cost) AS unit_cost
       FROM ims_stock s
       JOIN ims_product_variants pv ON pv.variant_id = s.variant_id
      WHERE s.business_id = ?
      ORDER BY s.variant_id, s.location_id${lock ? '\n      FOR UPDATE' : ''}`,
    [businessId],
  );
  return rows.map(row => ({
    variantId: String(row.variant_id),
    locationId: Number(row.location_id),
    quantity: Number(row.qty_on_hand),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
  }));
}

async function loadFifoLayerTotals(
  conn: PoolConnection,
  businessId: string,
  epochId: number,
  lock: boolean,
): Promise<Map<string, { quantity: number; value: number }>> {
  const [rows] = await conn.execute<any[]>(
    `SELECT variant_id, location_id, remaining_quantity, unit_cost
       FROM ims_fifo_cost_layers
      WHERE business_id = ? AND epoch_id = ? AND remaining_quantity > 0
      ORDER BY variant_id, location_id, fifo_date, id${lock ? '\n      FOR UPDATE' : ''}`,
    [businessId, epochId],
  );
  const totals = new Map<string, { quantity: number; value: number }>();
  for (const row of rows) {
    const key = `${row.variant_id}\u0000${Number(row.location_id)}`;
    const quantity = Number(row.remaining_quantity);
    const current = totals.get(key) ?? { quantity: 0, value: 0 };
    current.quantity += quantity;
    current.value += quantity * Number(row.unit_cost);
    totals.set(key, current);
  }
  return totals;
}

function buildPreview(
  currentMethod: InventoryCostMethod,
  targetMethod: InventoryCostMethod,
  revision: number,
  stock: StockSnapshot[],
  fifoTotals?: Map<string, { quantity: number; value: number }>,
): InventoryCostSwitchPreview {
  const blockers: string[] = [];
  const positive = stock.filter(row => row.quantity > QUANTITY_TOLERANCE);
  const negative = stock.filter(row => row.quantity < -QUANTITY_TOLERANCE);
  if (currentMethod === targetMethod) blockers.push(`Inventory costing is already set to ${targetMethod === 'fifo' ? 'FIFO' : 'Average Cost'}.`);
  if (negative.length > 0) blockers.push(`${negative.length} stock row(s) have negative on-hand quantity. Reconcile them before switching costing methods.`);

  let totalValue = 0;
  if (targetMethod === 'fifo') {
    const missingCost = positive.filter(row => row.unitCost == null || !Number.isFinite(row.unitCost) || row.unitCost <= 0);
    if (missingCost.length > 0) blockers.push(`${missingCost.length} positive stock row(s) have no valid positive average cost. Add or correct their costs before enabling FIFO.`);
    totalValue = positive.reduce((sum, row) => sum + row.quantity * Number(row.unitCost ?? 0), 0);
  } else {
    const unmatched = new Set(fifoTotals?.keys() ?? []);
    for (const row of stock) {
      const key = `${row.variantId}\u0000${row.locationId}`;
      const layer = fifoTotals?.get(key) ?? { quantity: 0, value: 0 };
      unmatched.delete(key);
      if (Math.abs(layer.quantity - row.quantity) > QUANTITY_TOLERANCE) {
        blockers.push(`FIFO layers do not reconcile for variant ${row.variantId} at location ${row.locationId}: stock is ${row.quantity}, layers total ${layer.quantity}.`);
      }
      totalValue += layer.value;
    }
    if (unmatched.size > 0) blockers.push(`${unmatched.size} FIFO layer position(s) have no matching stock row.`);
  }

  return {
    currentMethod,
    targetMethod,
    revision,
    stockRowCount: stock.length,
    positiveStockRowCount: positive.length,
    totalQuantity: positive.reduce((sum, row) => sum + row.quantity, 0),
    totalValue,
    blockers,
    warnings: [
      'The switch applies only to stock movements completed after activation.',
      'Historical movement costs and posted Xero COGS journals will not be recalculated.',
    ],
  };
}

async function previewInConnection(
  conn: PoolConnection,
  businessId: string,
  targetMethod: InventoryCostMethod,
  lock: boolean,
): Promise<InventoryCostSwitchPreview> {
  const state = await lockInventoryCostState(conn, businessId);
  const stock = await loadStockSnapshots(conn, businessId, lock);
  const fifoTotals = state.method === 'fifo' && state.epochId
    ? await loadFifoLayerTotals(conn, businessId, state.epochId, lock)
    : undefined;
  return buildPreview(state.method, targetMethod, state.revision, stock, fifoTotals);
}

export async function previewInventoryCostMethodSwitch(
  businessId: string,
  targetMethod: InventoryCostMethod,
): Promise<InventoryCostSwitchPreview> {
  if (!businessId) throw new Error('Business context is required.');
  if (!isInventoryCostMethod(targetMethod)) throw new Error('Inventory costing method must be Average Cost or FIFO.');
  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    const preview = await previewInConnection(conn, businessId, targetMethod, false);
    await conn.commit();
    return preview;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function switchInventoryCostMethod(input: SwitchInventoryCostMethodInput): Promise<{
  epochId: number;
  replayed: boolean;
  preview: InventoryCostSwitchPreview;
}> {
  validateSwitchInput(input);
  const hash = requestHash(input);
  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    const state = await lockInventoryCostState(conn, input.businessId);
    const [[existing]] = await conn.execute<any[]>(
      `SELECT id, request_hash, method, opening_quantity, opening_value
         FROM ims_inventory_cost_epochs
        WHERE business_id = ? AND operation_key = ?
        FOR UPDATE`,
      [input.businessId, input.operationKey.trim()],
    );
    if (existing) {
      if (String(existing.request_hash) !== hash) throw new FifoCostingConflict('This costing switch operation key was already used for a different request.');
      const stock = await loadStockSnapshots(conn, input.businessId, false);
      const preview = buildPreview(input.targetMethod, input.targetMethod, state.revision, stock);
      preview.blockers = [];
      await conn.commit();
      return { epochId: Number(existing.id), replayed: true, preview };
    }
    if (state.revision !== input.expectedRevision) {
      throw new FifoCostingConflict('Inventory costing changed after this preview was loaded. Refresh and review the latest costing state.');
    }

    const stock = await loadStockSnapshots(conn, input.businessId, true);
    const fifoTotals = state.method === 'fifo' && state.epochId
      ? await loadFifoLayerTotals(conn, input.businessId, state.epochId, true)
      : undefined;
    const preview = buildPreview(state.method, input.targetMethod, state.revision, stock, fifoTotals);
    if (preview.blockers.length > 0) throw new FifoCostingConflict(preview.blockers[0]);

    if (state.epochId) {
      await conn.execute(
        `UPDATE ims_inventory_cost_epochs SET status = 'closed', closed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND business_id = ? AND status = 'active'`,
        [state.epochId, input.businessId],
      );
    }
    const [epochResult] = await conn.execute<any>(
      `INSERT INTO ims_inventory_cost_epochs
        (business_id, method, status, operation_key, request_hash, opening_quantity, opening_value,
         switch_reason, actor_id, actor_name)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.businessId,
        input.targetMethod,
        input.operationKey.trim(),
        hash,
        preview.totalQuantity,
        preview.totalValue,
        input.reason.trim(),
        input.actorId ?? null,
        input.actorName ?? null,
      ],
    );
    const epochId = Number(epochResult.insertId);

    if (input.targetMethod === 'fifo') {
      const fifoState = { method: 'fifo' as const, epochId, revision: state.revision + 1 };
      const now = new Date();
      for (const row of stock) {
        if (row.quantity <= QUANTITY_TOLERANCE) continue;
        await createFifoCostLayer(conn, {
          businessId: input.businessId,
          state: fifoState,
          variantId: row.variantId,
          locationId: row.locationId,
          sourceType: 'method_switch_opening',
          sourceReferenceType: 'cost_epoch',
          sourceReferenceId: epochId,
          fifoDate: now,
          quantity: row.quantity,
          unitCost: Number(row.unitCost),
        });
      }
    } else {
      const variantTotals = new Map<string, { quantity: number; value: number }>();
      for (const row of stock) {
        const key = `${row.variantId}\u0000${row.locationId}`;
        const layer = fifoTotals?.get(key) ?? { quantity: 0, value: 0 };
        const total = variantTotals.get(row.variantId) ?? { quantity: 0, value: 0 };
        total.quantity += layer.quantity;
        total.value += layer.value;
        variantTotals.set(row.variantId, total);
      }
      for (const [variantId, total] of variantTotals) {
        const averageCost = total.quantity > QUANTITY_TOLERANCE ? total.value / total.quantity : 0;
        await conn.execute(`UPDATE ims_product_variants SET avg_cost = ? WHERE variant_id = ?`, [averageCost, variantId]);
        await conn.execute(`UPDATE ims_stock SET avg_cost = ? WHERE variant_id = ?`, [averageCost, variantId]);
      }
    }

    await conn.execute(
      `UPDATE ims_inventory_cost_state
          SET active_method = ?, active_epoch_id = ?, revision = revision + 1,
              last_switched_at = CURRENT_TIMESTAMP(3), last_switched_by = ?, last_switch_reason = ?
        WHERE business_id = ? AND revision = ?`,
      [input.targetMethod, epochId, input.actorId ?? null, input.reason.trim(), input.businessId, state.revision],
    );
    await conn.execute(
      `INSERT INTO ims_settings (business_id, \`key\`, value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [input.businessId, INVENTORY_COST_METHOD_SETTING_KEY, input.targetMethod],
    );
    await conn.commit();
    return { epochId, replayed: false, preview: { ...preview, revision: state.revision + 1 } };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}