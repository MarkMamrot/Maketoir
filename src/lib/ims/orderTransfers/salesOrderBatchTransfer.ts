import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import {
  SalesOrderTransferConflict,
  transferSalesOrderItemsInTransaction,
  type SalesOrderTransferLineInput,
  type SalesOrderTransferResult,
} from './salesOrderTransfer';
import { preflightSalesOrderXeroDocuments } from './salesOrderXeroPreflight';
import { reconcileSalesOrderTransferXero } from './salesOrderXeroReconciliation';

export type SalesOrderBatchTransferSource = {
  sourceOrderId: number;
  expectedSourceUpdatedAt?: string | null;
  lines: SalesOrderTransferLineInput[];
};

export type SalesOrderBatchTransferInput = {
  businessId: string;
  targetOrderId: number;
  expectedTargetUpdatedAt?: string | null;
  sources: SalesOrderBatchTransferSource[];
  operationKey: string;
  actorId?: number | null;
  actorName?: string | null;
};

export type SalesOrderBatchTransferResult = {
  replayed: boolean;
  targetOrderId: number;
  targetOrderNumber: string;
  sourceOrderIds: number[];
  transfers: SalesOrderTransferResult[];
  variantIds: string[];
};

type LockedOrder = {
  id: number;
  so_number: string;
  status: string;
  updated_at: string | Date | null;
};

type XeroLinkedOrder = { id: number; so_number: string; xero_invoice_id: string | null };

function assertRevision(actual: unknown, expected: string | null | undefined, label: string): void {
  if (!expected) return;
  const actualTime = actual instanceof Date ? actual.getTime() : new Date(String(actual ?? '')).getTime();
  const expectedTime = new Date(expected).getTime();
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime) || actualTime !== expectedTime) {
    throw new SalesOrderTransferConflict(`${label} changed after this preview. Refresh and review the latest order.`);
  }
}

function canonicalSources(sources: SalesOrderBatchTransferSource[]): SalesOrderBatchTransferSource[] {
  return sources
    .map(source => ({
      sourceOrderId: Number(source.sourceOrderId),
      expectedSourceUpdatedAt: source.expectedSourceUpdatedAt ?? null,
      lines: source.lines
        .map(line => ({
          sourceItemId: Number(line.sourceItemId),
          quantity: Number(line.quantity),
          allocatedIncomingQuantity: Number(line.allocatedIncomingQuantity),
        }))
        .sort((left, right) => left.sourceItemId - right.sourceItemId),
    }))
    .sort((left, right) => left.sourceOrderId - right.sourceOrderId);
}

export async function transferSalesOrderItemsBatch(
  input: SalesOrderBatchTransferInput,
): Promise<SalesOrderBatchTransferResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 100) {
    throw new SalesOrderTransferConflict('A valid batch operation key is required.');
  }
  if (!Number.isInteger(input.targetOrderId) || input.targetOrderId <= 0) {
    throw new SalesOrderTransferConflict('Choose a valid destination Sales Order.');
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new SalesOrderTransferConflict('Choose at least one source Sales Order.');
  }

  const sources = canonicalSources(input.sources);
  const sourceOrderIds = sources.map(source => source.sourceOrderId);
  if (new Set(sourceOrderIds).size !== sourceOrderIds.length
    || sourceOrderIds.some(sourceOrderId => !Number.isInteger(sourceOrderId) || sourceOrderId <= 0)) {
    throw new SalesOrderTransferConflict('Each source Sales Order must be valid and selected once.');
  }
  if (sourceOrderIds.includes(input.targetOrderId)) {
    throw new SalesOrderTransferConflict('The destination Sales Order cannot also be a source.');
  }
  if (sources.some(source => !Array.isArray(source.lines) || source.lines.length === 0)) {
    throw new SalesOrderTransferConflict('Select at least one quantity from every source Sales Order.');
  }

  const requestHash = createHash('sha256').update(JSON.stringify({
    targetOrderId: input.targetOrderId,
    sources: sources.map(source => ({ sourceOrderId: source.sourceOrderId, lines: source.lines })),
  })).digest('hex');
  const connection = await getIMSPool().getConnection();

  try {
    const allOrderIds = [input.targetOrderId, ...sourceOrderIds];
    const [xeroLinkedOrders] = await connection.execute<XeroLinkedOrder[]>(
      `SELECT id, so_number, xero_invoice_id FROM ims_sales_orders
        WHERE business_id = ? AND id IN (${allOrderIds.map(() => '?').join(', ')})`,
      [input.businessId, ...allOrderIds],
    );
    const xeroClearances = await preflightSalesOrderXeroDocuments(input.businessId, xeroLinkedOrders.map(order => ({
      orderId: Number(order.id),
      orderNumber: String(order.so_number),
      xeroDocumentId: order.xero_invoice_id ?? null,
    })));
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<any[]>(
      `SELECT request_hash, state, after_header_json
         FROM ims_order_amendment_operations
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash) {
        throw new SalesOrderTransferConflict('This batch move key was already used with different quantities.');
      }
      if (String(existing.state) !== 'complete') {
        throw new SalesOrderTransferConflict('This batch move is already being processed. Refresh before trying again.');
      }
      const after = typeof existing.after_header_json === 'string'
        ? JSON.parse(existing.after_header_json)
        : existing.after_header_json;
      if (!after?.transferBatchResult) {
        throw new SalesOrderTransferConflict('The completed batch move result could not be read.');
      }
      await connection.commit();
      return { ...after.transferBatchResult, replayed: true } as SalesOrderBatchTransferResult;
    }

    const orderIds = [input.targetOrderId, ...sourceOrderIds].sort((left, right) => left - right);
    const placeholders = orderIds.map(() => '?').join(', ');
    const [lockedOrders] = await connection.execute<LockedOrder[]>(
      `SELECT id, so_number, status, updated_at
         FROM ims_sales_orders
        WHERE business_id = ? AND id IN (${placeholders})
        ORDER BY id FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (lockedOrders.length !== orderIds.length) {
      throw new SalesOrderTransferConflict('One or more Sales Orders were not found.');
    }
    const orderById = new Map(lockedOrders.map(order => [Number(order.id), order]));
    const targetOrder = orderById.get(input.targetOrderId)!;
    assertRevision(targetOrder.updated_at, input.expectedTargetUpdatedAt, 'The destination Sales Order');
    for (const source of sources) {
      assertRevision(
        orderById.get(source.sourceOrderId)?.updated_at,
        source.expectedSourceUpdatedAt,
        `Source Sales Order ${orderById.get(source.sourceOrderId)?.so_number ?? source.sourceOrderId}`,
      );
    }

    const [batchOperationResult] = await connection.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'sales_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, input.targetOrderId, targetOrder.status,
        JSON.stringify({ targetOrder, sourceOrderIds }), input.actorId ?? null, input.actorName ?? null],
    );

    const transfers: SalesOrderTransferResult[] = [];
    for (const source of sources) {
      transfers.push(await transferSalesOrderItemsInTransaction(connection, {
        businessId: input.businessId,
        sourceOrderId: source.sourceOrderId,
        targetOrderId: input.targetOrderId,
        lines: source.lines,
        operationKey: `${operationKey}:source:${source.sourceOrderId}`,
        actorId: input.actorId,
        actorName: input.actorName,
        xeroClearances,
      }));
    }

    const result: SalesOrderBatchTransferResult = {
      replayed: false,
      targetOrderId: input.targetOrderId,
      targetOrderNumber: String(targetOrder.so_number),
      sourceOrderIds,
      transfers,
      variantIds: Array.from(new Set(transfers.flatMap(transfer => transfer.variantIds))),
    };
    await connection.execute(
      `UPDATE ims_order_amendment_operations
          SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ targetOrder, transferBatchResult: result }), input.businessId,
        Number(batchOperationResult.insertId)],
    );
    await connection.commit();
    await reconcileSalesOrderTransferXero(input.businessId, transfers);
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
