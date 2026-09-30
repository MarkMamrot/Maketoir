import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import {
  PurchaseOrderTransferConflict,
  transferPurchaseOrderItemsInTransaction,
  type PurchaseOrderTransferLineInput,
  type PurchaseOrderTransferResult,
} from './purchaseOrderTransfer';

export type PurchaseOrderBatchTransferSource = {
  sourceOrderId: number;
  expectedSourceUpdatedAt?: string | null;
  lines: PurchaseOrderTransferLineInput[];
};

export type PurchaseOrderBatchTransferInput = {
  businessId: string;
  targetOrderId: number;
  expectedTargetUpdatedAt?: string | null;
  sources: PurchaseOrderBatchTransferSource[];
  operationKey: string;
  actorId?: number | null;
  actorName?: string | null;
};

export type PurchaseOrderBatchTransferResult = {
  replayed: boolean;
  targetOrderId: number;
  targetOrderNumber: string;
  sourceOrderIds: number[];
  transfers: PurchaseOrderTransferResult[];
  variantIds: string[];
};

type LockedOrder = { id: number; po_number: string; status: string; updated_at: string | Date | null };

function assertRevision(actual: unknown, expected: string | null | undefined, label: string): void {
  if (!expected) return;
  const actualTime = actual instanceof Date ? actual.getTime() : new Date(String(actual ?? '')).getTime();
  const expectedTime = new Date(expected).getTime();
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime) || actualTime !== expectedTime) {
    throw new PurchaseOrderTransferConflict(`${label} changed after this preview. Refresh and review the latest order.`);
  }
}

function canonicalSources(sources: PurchaseOrderBatchTransferSource[]): PurchaseOrderBatchTransferSource[] {
  return sources.map(source => ({
    sourceOrderId: Number(source.sourceOrderId),
    expectedSourceUpdatedAt: source.expectedSourceUpdatedAt ?? null,
    lines: source.lines.map(line => ({
      sourceItemId: Number(line.sourceItemId),
      quantity: Number(line.quantity),
      allocations: (line.allocations ?? []).map(allocation => ({
        allocationId: Number(allocation.allocationId),
        revision: Number(allocation.revision),
        quantity: Number(allocation.quantity),
      })).sort((left, right) => left.allocationId - right.allocationId),
    })).sort((left, right) => left.sourceItemId - right.sourceItemId),
  })).sort((left, right) => left.sourceOrderId - right.sourceOrderId);
}

export async function transferPurchaseOrderItemsBatch(
  input: PurchaseOrderBatchTransferInput,
): Promise<PurchaseOrderBatchTransferResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 100) throw new PurchaseOrderTransferConflict('A valid batch operation key is required.');
  if (!Number.isInteger(input.targetOrderId) || input.targetOrderId <= 0) throw new PurchaseOrderTransferConflict('Choose a valid destination Purchase Order.');
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new PurchaseOrderTransferConflict('Choose at least one source Purchase Order.');

  const sources = canonicalSources(input.sources);
  const sourceOrderIds = sources.map(source => source.sourceOrderId);
  if (new Set(sourceOrderIds).size !== sourceOrderIds.length
    || sourceOrderIds.some(sourceOrderId => !Number.isInteger(sourceOrderId) || sourceOrderId <= 0)) {
    throw new PurchaseOrderTransferConflict('Each source Purchase Order must be valid and selected once.');
  }
  if (sourceOrderIds.includes(input.targetOrderId)) throw new PurchaseOrderTransferConflict('The destination Purchase Order cannot also be a source.');
  if (sources.some(source => !Array.isArray(source.lines) || source.lines.length === 0)) {
    throw new PurchaseOrderTransferConflict('Select at least one quantity from every source Purchase Order.');
  }

  const requestHash = createHash('sha256').update(JSON.stringify({
    targetOrderId: input.targetOrderId,
    sources: sources.map(source => ({ sourceOrderId: source.sourceOrderId, lines: source.lines })),
  })).digest('hex');
  const connection = await getIMSPool().getConnection();

  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<any[]>(
      `SELECT request_hash, state, after_header_json FROM ims_order_amendment_operations
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash) throw new PurchaseOrderTransferConflict('This batch move key was already used with different quantities.');
      if (String(existing.state) !== 'complete') throw new PurchaseOrderTransferConflict('This batch move is already being processed. Refresh before trying again.');
      const after = typeof existing.after_header_json === 'string' ? JSON.parse(existing.after_header_json) : existing.after_header_json;
      if (!after?.transferBatchResult) throw new PurchaseOrderTransferConflict('The completed batch move result could not be read.');
      await connection.commit();
      return { ...after.transferBatchResult, replayed: true };
    }

    const orderIds = [input.targetOrderId, ...sourceOrderIds].sort((left, right) => left - right);
    const placeholders = orderIds.map(() => '?').join(', ');
    const [lockedOrders] = await connection.execute<LockedOrder[]>(
      `SELECT id, po_number, status, updated_at FROM ims_purchase_orders
        WHERE business_id = ? AND id IN (${placeholders}) ORDER BY id FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (lockedOrders.length !== orderIds.length) throw new PurchaseOrderTransferConflict('One or more Purchase Orders were not found.');
    const orderById = new Map(lockedOrders.map(order => [Number(order.id), order]));
    const targetOrder = orderById.get(input.targetOrderId)!;
    assertRevision(targetOrder.updated_at, input.expectedTargetUpdatedAt, 'The destination Purchase Order');
    for (const source of sources) {
      const sourceOrder = orderById.get(source.sourceOrderId)!;
      assertRevision(sourceOrder.updated_at, source.expectedSourceUpdatedAt, `Source Purchase Order ${sourceOrder.po_number}`);
    }

    const [batchOperation] = await connection.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'purchase_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, input.targetOrderId, targetOrder.status,
        JSON.stringify({ targetOrder, sourceOrderIds }), input.actorId ?? null, input.actorName ?? null],
    );

    const transfers: PurchaseOrderTransferResult[] = [];
    for (const source of sources) {
      transfers.push(await transferPurchaseOrderItemsInTransaction(connection, {
        businessId: input.businessId,
        sourceOrderId: source.sourceOrderId,
        targetOrderId: input.targetOrderId,
        lines: source.lines,
        operationKey: `${operationKey}:source:${source.sourceOrderId}`,
        actorId: input.actorId,
        actorName: input.actorName,
      }));
    }

    const result: PurchaseOrderBatchTransferResult = {
      replayed: false,
      targetOrderId: input.targetOrderId,
      targetOrderNumber: String(targetOrder.po_number),
      sourceOrderIds,
      transfers,
      variantIds: Array.from(new Set(transfers.flatMap(transfer => transfer.variantIds))),
    };
    await connection.execute(
      `UPDATE ims_order_amendment_operations SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ targetOrder, transferBatchResult: result }), input.businessId, Number(batchOperation.insertId)],
    );
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
