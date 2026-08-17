import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';

const QUANTITY_SCALE = 10_000;

export class StockAllocationConflict extends Error {
  readonly status = 409;
}

export type CreateStockAllocationInput = {
  businessId: string;
  operationKey: string;
  soItemId: number;
  poItemId: number;
  quantity: number;
  promisedDate?: string | null;
  priority?: number;
  overrideReason?: string | null;
  actorId?: number | null;
  actorName?: string | null;
};

function scaledQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Allocation quantity must be finite.');
  return Math.round(value * QUANTITY_SCALE);
}

function canonicalRequest(input: CreateStockAllocationInput) {
  return {
    action: 'allocate',
    soItemId: Number(input.soItemId),
    poItemId: Number(input.poItemId),
    quantity: scaledQuantity(Number(input.quantity)) / QUANTITY_SCALE,
    promisedDate: input.promisedDate?.trim() || null,
    priority: Math.trunc(Number(input.priority ?? 0)),
    overrideReason: input.overrideReason?.trim() || null,
  };
}

export function buildStockAllocationRequestHash(input: CreateStockAllocationInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalRequest(input))).digest('hex');
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return null; }
}

export async function createStockAllocation(input: CreateStockAllocationInput): Promise<{
  allocationId: number;
  replayed: boolean;
}> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid allocation operation key is required.');
  if (!input.businessId) throw new Error('Business context is required.');
  const requestedScaled = scaledQuantity(Number(input.quantity));
  if (requestedScaled <= 0) throw new Error('Allocation quantity must be greater than zero.');
  const request = canonicalRequest(input);
  const requestHash = buildStockAllocationRequestHash(input);
  const conn = await getIMSPool().getConnection();

  try {
    await conn.beginTransaction();
    const [[soItem]] = await conn.execute<any[]>(
      `SELECT soi.id, soi.so_id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled,
              so.business_id, so.location_id, so.status
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id
        WHERE soi.id = ? AND soi.business_id = ? AND so.business_id = ?
        FOR UPDATE`,
      [input.soItemId, input.businessId, input.businessId],
    );
    if (!soItem) throw new StockAllocationConflict('Sales order line was not found.');
    if (!['confirmed', 'partially_fulfilled', 'backordered'].includes(String(soItem.status))) {
      throw new StockAllocationConflict('Only confirmed, partially fulfilled, or held backorder demand can receive incoming allocation.');
    }

    const [[poItem]] = await conn.execute<any[]>(
      `SELECT poi.id, poi.po_id, poi.variant_id, poi.qty_ordered, poi.qty_received,
              po.business_id, po.location_id, po.status, po.expected_date
         FROM ims_purchase_order_items poi
         JOIN ims_purchase_orders po ON po.id = poi.po_id
        WHERE poi.id = ? AND poi.business_id = ? AND po.business_id = ?
        FOR UPDATE`,
      [input.poItemId, input.businessId, input.businessId],
    );
    if (!poItem) throw new StockAllocationConflict('Purchase order line was not found.');
    if (!['confirmed', 'partially_received'].includes(String(poItem.status))) {
      throw new StockAllocationConflict('Only confirmed or partially received purchase orders can supply a protected allocation.');
    }
    if (String(soItem.variant_id) !== String(poItem.variant_id) || Number(soItem.location_id) !== Number(poItem.location_id)) {
      throw new StockAllocationConflict('Allocation supply must match the sales order variant and location.');
    }

    const [operationRows] = await conn.execute<any[]>(
      `SELECT id, request_hash, state, response_json
         FROM ims_stock_allocation_operations
        WHERE business_id = ? AND operation_key = ?
        LIMIT 1 FOR UPDATE`,
      [input.businessId, operationKey],
    );
    if (operationRows[0]) {
      if (String(operationRows[0].request_hash) !== requestHash) {
        throw new StockAllocationConflict('This allocation operation key was already used for a different request.');
      }
      if (operationRows[0].state !== 'complete') {
        throw new StockAllocationConflict('This allocation operation is already in progress.');
      }
      const response = parseJson<{ allocationId: number }>(operationRows[0].response_json);
      if (!response?.allocationId) throw new Error('Completed allocation operation has no stored result.');
      await conn.commit();
      return { allocationId: Number(response.allocationId), replayed: true };
    }

    const [soAllocationRows] = await conn.execute<any[]>(
      `SELECT qty_allocated, qty_fulfilled
         FROM ims_stock_allocations
        WHERE business_id = ? AND so_item_id = ? AND state = 'active'
        FOR UPDATE`,
      [input.businessId, input.soItemId],
    );
    const allocatedOutstanding = soAllocationRows.reduce(
      (sum, row) => sum + Number(row.qty_allocated) - Number(row.qty_fulfilled),
      0,
    );
    const soFreeScaled = scaledQuantity(Number(soItem.qty_ordered) - Number(soItem.qty_fulfilled ?? 0))
      - scaledQuantity(allocatedOutstanding);
    if (requestedScaled > soFreeScaled) {
      throw new StockAllocationConflict('Allocation exceeds the sales order line quantity still awaiting supply.');
    }

    const [poAllocationRows] = await conn.execute<any[]>(
      `SELECT qty_allocated, qty_received_assigned
         FROM ims_stock_allocations
        WHERE business_id = ? AND po_item_id = ? AND state = 'active'
        FOR UPDATE`,
      [input.businessId, input.poItemId],
    );
    const allocatedIncoming = poAllocationRows.reduce(
      (sum, row) => sum + Number(row.qty_allocated) - Number(row.qty_received_assigned),
      0,
    );
    const poFreeScaled = scaledQuantity(Number(poItem.qty_ordered) - Number(poItem.qty_received ?? 0))
      - scaledQuantity(allocatedIncoming);
    if (requestedScaled > poFreeScaled) {
      throw new StockAllocationConflict('Allocation exceeds the purchase order quantity still free and incoming.');
    }

    const [operationResult] = await conn.execute<any>(
      `INSERT INTO ims_stock_allocation_operations
        (business_id, operation_key, request_hash, action, state, request_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'allocate', 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, JSON.stringify(request), input.actorId ?? null, input.actorName ?? null],
    );
    const [allocationResult] = await conn.execute<any>(
      `INSERT INTO ims_stock_allocations
        (business_id, so_id, so_item_id, po_id, po_item_id, variant_id, location_id, qty_allocated,
         source_expected_date, promised_date, promise_status, priority, override_reason, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, soItem.so_id, input.soItemId, poItem.po_id, input.poItemId,
        soItem.variant_id, soItem.location_id, Number(input.quantity), poItem.expected_date ?? null,
        request.promisedDate, request.promisedDate ? 'confirmed' : 'unpromised', request.priority,
        request.overrideReason, input.actorId ?? null, input.actorName ?? null],
    );
    const allocationId = Number(allocationResult.insertId);
    const response = { allocationId };
    await conn.execute(
      `UPDATE ims_stock_allocation_operations
          SET allocation_id = ?, state = 'complete', response_json = ?, completed_at = NOW()
        WHERE id = ? AND business_id = ?`,
      [allocationId, JSON.stringify(response), operationResult.insertId, input.businessId],
    );
    await conn.commit();
    return { allocationId, replayed: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function assignReceiptToStockAllocations(
  conn: { execute: (sql: string, params?: unknown[]) => Promise<any> },
  input: { businessId: string; poItemId: number; receivedQuantity: number },
): Promise<Array<{ allocationId: number; soId: number; soItemId: number; quantity: number; ready: boolean }>> {
  let remainingScaled = scaledQuantity(input.receivedQuantity);
  if (remainingScaled <= 0) return [];
  const [rows] = await conn.execute(
    `SELECT id, so_id, so_item_id, qty_allocated, qty_received_assigned
       FROM ims_stock_allocations
      WHERE business_id = ? AND po_item_id = ? AND state = 'active'
      ORDER BY priority, created_at, id
      FOR UPDATE`,
    [input.businessId, input.poItemId],
  );
  const assignments: Array<{ allocationId: number; soId: number; soItemId: number; quantity: number; ready: boolean }> = [];
  for (const row of rows as any[]) {
    if (remainingScaled <= 0) break;
    const allocationRemaining = Math.max(
      0,
      scaledQuantity(Number(row.qty_allocated)) - scaledQuantity(Number(row.qty_received_assigned)),
    );
    if (allocationRemaining === 0) continue;
    const assignedScaled = Math.min(remainingScaled, allocationRemaining);
    const assigned = assignedScaled / QUANTITY_SCALE;
    await conn.execute(
      `UPDATE ims_stock_allocations
          SET qty_received_assigned = qty_received_assigned + ?, revision = revision + 1
        WHERE id = ? AND business_id = ?`,
      [assigned, row.id, input.businessId],
    );
    const ready = assignedScaled === allocationRemaining;
    assignments.push({
      allocationId: Number(row.id),
      soId: Number(row.so_id),
      soItemId: Number(row.so_item_id),
      quantity: assigned,
      ready,
    });
    remainingScaled -= assignedScaled;
  }
  return assignments;
}

export async function listStockAllocations(input: { businessId: string; soId?: number; poId?: number }) {
  if (!input.soId && !input.poId) throw new Error('A sales order or purchase order is required.');
  const clauses = ['a.business_id = ?'];
  const params: unknown[] = [input.businessId];
  if (input.soId) { clauses.push('a.so_id = ?'); params.push(input.soId); }
  if (input.poId) { clauses.push('a.po_id = ?'); params.push(input.poId); }
  const [rows] = await getIMSPool().execute<any[]>(
    `SELECT a.id, a.so_id, a.so_item_id, a.po_id, a.po_item_id, a.variant_id, a.location_id,
            a.qty_allocated, a.qty_received_assigned, a.qty_fulfilled, a.source_expected_date,
            a.promised_date, a.promise_status, a.state, a.priority, a.override_reason, a.risk_reason,
            so.so_number, po.po_number
       FROM ims_stock_allocations a
       JOIN ims_sales_orders so ON so.id = a.so_id AND so.business_id = a.business_id
       JOIN ims_purchase_orders po ON po.id = a.po_id AND po.business_id = a.business_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY a.state = 'active' DESC, a.priority, a.created_at, a.id`,
    params,
  );
  return rows.map(row => ({
    ...row,
    qty_allocated: Number(row.qty_allocated),
    qty_received_assigned: Number(row.qty_received_assigned),
    qty_fulfilled: Number(row.qty_fulfilled),
  }));
}