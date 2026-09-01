import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { getIMSPool } from '@/services/IMSMySQLService';
import { assertExpectedInventoryDocumentRevision } from '../creditNoteStatusCommands';
import { assertAllowedInventoryDocumentAction } from '../inventoryDocumentLifecycle';
import {
  claimInventoryDocumentOperation,
  completeInventoryDocumentOperation,
  type InventoryDocumentOperationContext,
} from '../inventoryDocumentOperations';

interface StocktakeOperationInput {
  businessId: string;
  stocktakeId: number;
  context: InventoryDocumentOperationContext;
}

interface StocktakeHeader extends RowDataPacket {
  id: number;
  business_id: string;
  location_id: number;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'reverted';
  updated_at: string | Date | null;
  xero_journal_id: string | null;
  xero_sync_status: string | null;
}

interface StocktakeItem extends RowDataPacket {
  id: number;
  variant_id: string;
  expected_qty: number;
  counted_qty: number | null;
  soh_at_apply: number | null;
  applied_delta: number | null;
  unit_cost_at_apply: number | null;
}

export interface StocktakeApplyResult {
  id: number;
  status: 'completed';
  applied: number;
  variances: number;
  countStartVariances: number;
  replayed: boolean;
}

export interface StocktakeRevertResult {
  id: number;
  status: 'reverted';
  reverted: number;
  replayed: boolean;
  xeroReversalStatus: 'queued' | 'blocked' | 'not_required';
}

export interface StocktakeTransitionResult {
  id: number;
  status: 'in_progress' | 'cancelled';
  replayed: boolean;
}

export class StocktakeOperationConflict extends Error {
  readonly code = 'stocktake_operation_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'StocktakeOperationConflict';
  }
}

async function lockHeader(connection: PoolConnection, businessId: string, stocktakeId: number): Promise<StocktakeHeader> {
  const [rows] = await connection.execute<StocktakeHeader[]>(
    `SELECT * FROM ims_stocktakes WHERE id = ? AND business_id = ? FOR UPDATE`,
    [stocktakeId, businessId],
  );
  if (!rows[0]) throw new StocktakeOperationConflict('Stocktake not found.');
  return rows[0];
}

async function lockItems(connection: PoolConnection, stocktakeId: number): Promise<StocktakeItem[]> {
  const [rows] = await connection.execute<StocktakeItem[]>(
    `SELECT id, variant_id, expected_qty, counted_qty, soh_at_apply, applied_delta, unit_cost_at_apply
       FROM ims_stocktake_items
      WHERE stocktake_id = ?
      ORDER BY id
      FOR UPDATE`,
    [stocktakeId],
  );
  return rows;
}

async function lockStockQuantity(
  connection: PoolConnection,
  businessId: string,
  variantId: string,
  locationId: number,
): Promise<number> {
  await connection.execute(
    `INSERT IGNORE INTO ims_stock (business_id, variant_id, location_id) VALUES (?, ?, ?)`,
    [businessId, variantId, locationId],
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT qty_on_hand FROM ims_stock
      WHERE business_id = ? AND variant_id = ? AND location_id = ? FOR UPDATE`,
    [businessId, variantId, locationId],
  );
  if (!rows[0]) throw new StocktakeOperationConflict(`Stock for variant ${variantId} could not be locked.`);
  return Number(rows[0].qty_on_hand ?? 0);
}

async function getUnitCostAtApply(connection: PoolConnection, businessId: string, variantId: string): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(avg_cost, 0), NULLIF(cost_aud, 0), 0) AS unit_cost
       FROM ims_product_variants
      WHERE business_id = ? AND variant_id = ?
      LIMIT 1`,
    [businessId, variantId],
  );
  return Number(rows[0]?.unit_cost ?? 0);
}

export async function transitionStocktake(
  input: StocktakeOperationInput & { action: 'start' | 'cancel' },
): Promise<StocktakeTransitionResult> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const stocktake = await lockHeader(connection, input.businessId, input.stocktakeId);
    const operation = await claimInventoryDocumentOperation<StocktakeTransitionResult>(connection, input.context, {
      businessId: input.businessId,
      documentKind: 'stocktake',
      documentId: input.stocktakeId,
      action: input.action,
      documentStatus: stocktake.status,
      beforeMetadata: { status: stocktake.status, locationId: stocktake.location_id },
    });
    if (operation.replayed) {
      await connection.commit();
      return operation.response ? { ...operation.response, replayed: true } : {
        id: input.stocktakeId,
        status: input.action === 'start' ? 'in_progress' : 'cancelled',
        replayed: true,
      };
    }
    assertExpectedInventoryDocumentRevision(stocktake.updated_at, input.context.expectedUpdatedAt);
    const target = assertAllowedInventoryDocumentAction('stocktake', stocktake.status, input.action) as StocktakeTransitionResult['status'];
    await connection.execute(
      `UPDATE ims_stocktakes SET status = ? WHERE id = ? AND business_id = ?`,
      [target, input.stocktakeId, input.businessId],
    );
    const response: StocktakeTransitionResult = { id: input.stocktakeId, status: target, replayed: false };
    await completeInventoryDocumentOperation(
      connection, input.businessId, operation.operationId, target, response, { status: target },
    );
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function applyStocktakeInTransaction(
  connection: PoolConnection,
  input: StocktakeOperationInput,
): Promise<StocktakeApplyResult> {
    const stocktake = await lockHeader(connection, input.businessId, input.stocktakeId);
    const operation = await claimInventoryDocumentOperation<StocktakeApplyResult>(connection, input.context, {
      businessId: input.businessId,
      documentKind: 'stocktake',
      documentId: input.stocktakeId,
      action: 'complete',
      documentStatus: stocktake.status,
      beforeMetadata: { status: stocktake.status, locationId: stocktake.location_id },
    });
    if (operation.replayed) {
      return operation.response ? { ...operation.response, replayed: true } : {
        id: input.stocktakeId, status: 'completed', applied: 0, variances: 0, countStartVariances: 0, replayed: true,
      };
    }
    assertExpectedInventoryDocumentRevision(stocktake.updated_at, input.context.expectedUpdatedAt);
    assertAllowedInventoryDocumentAction('stocktake', stocktake.status, 'complete');

    const items = (await lockItems(connection, input.stocktakeId)).filter(item => item.counted_qty !== null);
    let variances = 0;
    let countStartVariances = 0;
    for (const item of items) {
      const counted = Number(item.counted_qty);
      if (!Number.isFinite(counted) || counted < 0) {
        throw new StocktakeOperationConflict(`Counted quantity for variant ${item.variant_id} must be zero or greater.`);
      }
      const currentOnHand = await lockStockQuantity(
        connection, input.businessId, item.variant_id, Number(stocktake.location_id),
      );
      const appliedDelta = counted - currentOnHand;
      const unitCost = await getUnitCostAtApply(connection, input.businessId, item.variant_id);
      if (Math.abs(counted - Number(item.expected_qty)) > 0.0001) countStartVariances++;
      if (Math.abs(appliedDelta) > 0.0001) {
        variances++;
        await connection.execute(
          `UPDATE ims_stock SET qty_on_hand = ?
            WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
          [counted, input.businessId, item.variant_id, stocktake.location_id],
        );
        await connection.execute(
          `INSERT INTO ims_stock_movements
             (business_id, variant_id, location_id, movement_type, reference_type, reference_id,
              qty_change, qty_after_soh, unit_cost)
           VALUES (?, ?, ?, 'stocktake', 'stocktake', ?, ?, ?, ?)`,
          [input.businessId, item.variant_id, stocktake.location_id, input.stocktakeId, appliedDelta, counted, unitCost],
        );
      }
      await connection.execute(
        `UPDATE ims_stocktake_items
            SET soh_at_apply = ?, applied_delta = ?, unit_cost_at_apply = ?
          WHERE id = ? AND stocktake_id = ?`,
        [currentOnHand, appliedDelta, unitCost, item.id, input.stocktakeId],
      );
    }

    await connection.execute(
      `UPDATE ims_stocktakes SET status = 'completed', completed_at = NOW()
        WHERE id = ? AND business_id = ?`,
      [input.stocktakeId, input.businessId],
    );
    const response: StocktakeApplyResult = {
      id: input.stocktakeId,
      status: 'completed',
      applied: items.length,
      variances,
      countStartVariances,
      replayed: false,
    };
    await completeInventoryDocumentOperation(
      connection,
      input.businessId,
      operation.operationId,
      'completed',
      response,
      { status: 'completed', appliedLineCount: items.length, actualAdjustmentCount: variances, countStartVarianceCount: countStartVariances },
    );
    return response;
}

export async function applyStocktake(input: StocktakeOperationInput): Promise<StocktakeApplyResult> {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const response = await applyStocktakeInTransaction(connection, input);
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revertStocktake(
  input: StocktakeOperationInput & { reason: string },
): Promise<StocktakeRevertResult> {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new StocktakeOperationConflict('A reversal reason is required.');
  if (reason.length > 500) throw new StocktakeOperationConflict('The reversal reason must be 500 characters or fewer.');
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const stocktake = await lockHeader(connection, input.businessId, input.stocktakeId);
    const operation = await claimInventoryDocumentOperation<StocktakeRevertResult>(connection, input.context, {
      businessId: input.businessId,
      documentKind: 'stocktake',
      documentId: input.stocktakeId,
      action: 'revert_mistaken_completion',
      documentStatus: stocktake.status,
      beforeMetadata: { status: stocktake.status, locationId: stocktake.location_id },
    });
    if (operation.replayed) {
      await connection.commit();
      return operation.response ? { ...operation.response, replayed: true } : {
        id: input.stocktakeId, status: 'reverted', reverted: 0, replayed: true, xeroReversalStatus: 'not_required',
      };
    }
    assertExpectedInventoryDocumentRevision(stocktake.updated_at, input.context.expectedUpdatedAt);
    assertAllowedInventoryDocumentAction('stocktake', stocktake.status, 'revert_mistaken_completion');

    const countedItems = (await lockItems(connection, input.stocktakeId)).filter(item => item.counted_qty !== null);
    if (countedItems.some(item => item.applied_delta === null)) {
      throw new StocktakeOperationConflict(
        'This stocktake predates exact apply snapshots and cannot be reversed automatically. Use a new stock adjustment with accounting review.',
      );
    }
    const items = countedItems.filter(item => item.applied_delta !== null);
    let reverted = 0;
    for (const item of items) {
      const appliedDelta = Number(item.applied_delta);
      const currentOnHand = await lockStockQuantity(
        connection, input.businessId, item.variant_id, Number(stocktake.location_id),
      );
      const resultingOnHand = currentOnHand - appliedDelta;
      if (resultingOnHand < -0.0001) {
        throw new StocktakeOperationConflict(
          `Variant ${item.variant_id} would fall below zero when compensating this stocktake. Correct current stock before retrying.`,
        );
      }
      if (Math.abs(appliedDelta) > 0.0001) {
        await connection.execute(
          `UPDATE ims_stock SET qty_on_hand = ?
            WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
          [resultingOnHand, input.businessId, item.variant_id, stocktake.location_id],
        );
        await connection.execute(
          `INSERT INTO ims_stock_movements
             (business_id, variant_id, location_id, movement_type, reference_type, reference_id,
              qty_change, qty_after_soh, unit_cost, notes)
           VALUES (?, ?, ?, 'stocktake_reverted', 'stocktake', ?, ?, ?, ?, ?)`,
          [input.businessId, item.variant_id, stocktake.location_id, input.stocktakeId, -appliedDelta,
            resultingOnHand, item.unit_cost_at_apply, reason],
        );
        reverted++;
      }
    }

    const xeroReversalStatus: StocktakeRevertResult['xeroReversalStatus'] = stocktake.xero_journal_id
      ? stocktake.xero_sync_status === 'synced' ? 'queued' : 'blocked'
      : stocktake.xero_sync_status === 'error' ? 'blocked' : 'not_required';
    await connection.execute(
      `UPDATE ims_stocktakes
          SET status = 'reverted', reverted_at = NOW(), reversal_reason = ?, reversed_by = ?,
              xero_reversal_sync_status = ?, xero_reversal_error = NULL
        WHERE id = ? AND business_id = ?`,
      [reason, input.context.actorId ?? null, xeroReversalStatus, input.stocktakeId, input.businessId],
    );
    const response: StocktakeRevertResult = {
      id: input.stocktakeId,
      status: 'reverted',
      reverted,
      replayed: false,
      xeroReversalStatus,
    };
    await completeInventoryDocumentOperation(
      connection,
      input.businessId,
      operation.operationId,
      'reverted',
      response,
      { status: 'reverted', compensatedMovementCount: reverted, reason, xeroReversalStatus },
    );
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
