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

export type MutateStockAllocationInput = {
  businessId: string;
  operationKey: string;
  allocationId: number;
  revision: number;
  action: 'resize' | 'release' | 'reassign' | 'revise_promise';
  quantity?: number;
  poItemId?: number;
  promisedDate?: string | null;
  reason?: string | null;
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

function canonicalMutationRequest(input: MutateStockAllocationInput) {
  return {
    action: input.action,
    allocationId: Number(input.allocationId),
    revision: Math.trunc(Number(input.revision)),
    quantity: input.quantity == null ? null : scaledQuantity(Number(input.quantity)) / QUANTITY_SCALE,
    poItemId: input.poItemId == null ? null : Number(input.poItemId),
    promisedDate: input.promisedDate?.trim() || null,
    reason: input.reason?.trim() || null,
  };
}

export function buildStockAllocationMutationRequestHash(input: MutateStockAllocationInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalMutationRequest(input))).digest('hex');
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
            a.revision, so.so_number, po.po_number
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

export async function mutateStockAllocation(input: MutateStockAllocationInput): Promise<{
  allocationId: number;
  revision: number;
  state: string;
  replayed: boolean;
}> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid allocation operation key is required.');
  if (!input.businessId) throw new Error('Business context is required.');
  if (!Number.isInteger(input.allocationId) || input.allocationId <= 0) throw new Error('A valid allocation is required.');
  if (!Number.isInteger(input.revision) || input.revision <= 0) throw new Error('A valid allocation revision is required.');
  const request = canonicalMutationRequest(input);
  if (input.action === 'resize' && (request.quantity == null || scaledQuantity(request.quantity) <= 0)) {
    throw new Error('Resized allocation quantity must be greater than zero.');
  }
  if (input.action === 'reassign' && (!Number.isInteger(request.poItemId) || Number(request.poItemId) <= 0)) {
    throw new Error('A valid destination purchase order line is required.');
  }
  if (input.action === 'release' && !request.reason) throw new Error('A release reason is required.');
  if (input.action === 'reassign' && !request.reason) throw new Error('A reassignment reason is required.');
  if (input.action === 'revise_promise' && !request.reason) throw new Error('A promise revision reason is required.');

  const requestHash = buildStockAllocationMutationRequestHash(input);
  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    const [operationRows] = await conn.execute<any[]>(
      `SELECT request_hash, state, response_json FROM ims_stock_allocation_operations
        WHERE business_id = ? AND operation_key = ? LIMIT 1 FOR UPDATE`,
      [input.businessId, operationKey],
    );
    if (operationRows[0]) {
      if (String(operationRows[0].request_hash) !== requestHash) {
        throw new StockAllocationConflict('This allocation operation key was already used for a different request.');
      }
      if (operationRows[0].state !== 'complete') throw new StockAllocationConflict('This allocation operation is already in progress.');
      const response = parseJson<{ allocationId: number; revision: number; state: string }>(operationRows[0].response_json);
      if (!response?.allocationId) throw new Error('Completed allocation operation has no stored result.');
      await conn.commit();
      return { ...response, replayed: true };
    }

    const [[allocation]] = await conn.execute<any[]>(
      `SELECT * FROM ims_stock_allocations
        WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE`,
      [input.allocationId, input.businessId],
    );
    if (!allocation) throw new StockAllocationConflict('Stock allocation was not found.');
    if (allocation.state !== 'active') throw new StockAllocationConflict('Only active stock allocations can be changed.');
    if (Number(allocation.revision) !== input.revision) throw new StockAllocationConflict('Stock allocation changed. Refresh and try again.');

    let nextPoItemId = Number(allocation.po_item_id);
    let nextPoId = Number(allocation.po_id);
    let nextExpectedDate = allocation.source_expected_date ?? null;
    let nextQuantity = Number(allocation.qty_allocated);
    let nextState = 'active';
    if (input.action === 'resize') nextQuantity = Number(request.quantity);
    if (input.action === 'release') nextState = 'released';

    if (scaledQuantity(nextQuantity) < scaledQuantity(Number(allocation.qty_received_assigned))
      || scaledQuantity(nextQuantity) < scaledQuantity(Number(allocation.qty_fulfilled))) {
      throw new StockAllocationConflict('Allocation quantity cannot be less than its received or fulfilled quantity.');
    }

    if (input.action === 'reassign') {
      const [[poItem]] = await conn.execute<any[]>(
        `SELECT poi.id, poi.po_id, poi.variant_id, poi.qty_ordered, poi.qty_received,
                po.location_id, po.status, po.expected_date
           FROM ims_purchase_order_items poi
           JOIN ims_purchase_orders po ON po.id = poi.po_id AND po.business_id = ?
          WHERE poi.id = ? AND poi.business_id = ? FOR UPDATE`,
        [input.businessId, request.poItemId, input.businessId],
      );
      if (!poItem) throw new StockAllocationConflict('Destination purchase order line was not found.');
      if (!['confirmed', 'partially_received'].includes(String(poItem.status))) {
        throw new StockAllocationConflict('Only confirmed or partially received purchase orders can supply a protected allocation.');
      }
      if (String(poItem.variant_id) !== String(allocation.variant_id) || Number(poItem.location_id) !== Number(allocation.location_id)) {
        throw new StockAllocationConflict('Allocation supply must match the sales order variant and location.');
      }
      const [rows] = await conn.execute<any[]>(
        `SELECT qty_allocated, qty_received_assigned FROM ims_stock_allocations
          WHERE business_id = ? AND po_item_id = ? AND state = 'active' AND id <> ? FOR UPDATE`,
        [input.businessId, request.poItemId, input.allocationId],
      );
      const allocatedIncoming = rows.reduce((sum, row) => sum + Number(row.qty_allocated) - Number(row.qty_received_assigned), 0);
      const freeScaled = scaledQuantity(Number(poItem.qty_ordered) - Number(poItem.qty_received ?? 0)) - scaledQuantity(allocatedIncoming);
      const neededScaled = scaledQuantity(nextQuantity) - scaledQuantity(Number(allocation.qty_received_assigned));
      if (neededScaled > freeScaled) throw new StockAllocationConflict('Allocation exceeds the destination purchase order quantity still free and incoming.');
      nextPoItemId = Number(poItem.id);
      nextPoId = Number(poItem.po_id);
      nextExpectedDate = poItem.expected_date ?? null;
    }

    const [operationResult] = await conn.execute<any>(
      `INSERT INTO ims_stock_allocation_operations
        (business_id, operation_key, request_hash, action, allocation_id, state, request_json, actor_id, actor_name)
       VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, input.action, input.allocationId, JSON.stringify(request), input.actorId ?? null, input.actorName ?? null],
    );
    const nextRevision = input.revision + 1;
    await conn.execute(
      `UPDATE ims_stock_allocations SET
          po_id = ?, po_item_id = ?, qty_allocated = ?, source_expected_date = ?,
          promised_date = CASE WHEN ? = 'revise_promise' THEN ? ELSE promised_date END,
          promise_status = CASE
            WHEN ? = 'reassign' THEN 'at_risk'
            WHEN ? = 'revise_promise' THEN CASE WHEN ? IS NULL THEN 'unpromised' ELSE 'confirmed' END
            ELSE promise_status END,
          risk_reason = CASE WHEN ? = 'reassign' THEN ? WHEN ? = 'revise_promise' THEN NULL ELSE risk_reason END,
          state = ?, released_at = CASE WHEN ? = 'release' THEN NOW() ELSE released_at END,
          released_by = CASE WHEN ? = 'release' THEN ? ELSE released_by END,
          released_by_name = CASE WHEN ? = 'release' THEN ? ELSE released_by_name END,
          released_reason = CASE WHEN ? = 'release' THEN ? ELSE released_reason END,
          override_reason = CASE WHEN ? = 'reassign' THEN ? ELSE override_reason END,
          revision = ?
        WHERE id = ? AND business_id = ? AND revision = ?`,
      [nextPoId, nextPoItemId, nextQuantity, nextExpectedDate,
        input.action, request.promisedDate, input.action, input.action, request.promisedDate,
        input.action, request.reason, input.action, nextState, input.action,
        input.action, input.actorId ?? null, input.action, input.actorName ?? null,
        input.action, request.reason, input.action, request.reason,
        nextRevision, input.allocationId, input.businessId, input.revision],
    );
    const response = { allocationId: input.allocationId, revision: nextRevision, state: nextState };
    await conn.execute(
      `UPDATE ims_stock_allocation_operations SET state = 'complete', response_json = ?, completed_at = NOW()
        WHERE id = ? AND business_id = ?`,
      [JSON.stringify(response), operationResult.insertId, input.businessId],
    );
    await conn.commit();
    return { ...response, replayed: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

type AllocationConnection = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export async function assertNoActiveStockAllocations(
  conn: AllocationConnection,
  input: { businessId: string; orderKind: 'sales_order' | 'purchase_order'; orderId: number; operation: string },
): Promise<void> {
  const column = input.orderKind === 'sales_order' ? 'so_id' : 'po_id';
  const [rows] = await conn.execute(
    `SELECT id FROM ims_stock_allocations
      WHERE business_id = ? AND ${column} = ? AND state = 'active' LIMIT 1 FOR UPDATE`,
    [input.businessId, input.orderId],
  );
  if ((rows as any[])[0]) {
    const label = input.orderKind === 'sales_order' ? 'sales order' : 'purchase order';
    throw new StockAllocationConflict(`Release or reassign active incoming allocations before ${input.operation} this ${label}.`);
  }
}

export async function markPurchaseOrderAllocationPromisesAtRisk(
  conn: AllocationConnection,
  input: { businessId: string; poId: number; expectedDate: string | null; reason: string },
): Promise<number> {
  const [result] = await conn.execute(
    `UPDATE ims_stock_allocations
        SET source_expected_date = ?,
            promise_status = CASE WHEN promise_status = 'confirmed' THEN 'at_risk' ELSE promise_status END,
            risk_reason = CASE WHEN promise_status IN ('confirmed','at_risk') THEN ? ELSE risk_reason END,
            revision = revision + 1
      WHERE business_id = ? AND po_id = ? AND state = 'active'`,
    [input.expectedDate, input.reason, input.businessId, input.poId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function transferStockAllocationsToBackorderLine(
  conn: AllocationConnection,
  input: {
    businessId: string;
    sourceSoItemId: number;
    backorderSoId: number;
    backorderSoItemId: number;
    quantity: number;
  },
): Promise<number> {
  let remainingScaled = scaledQuantity(input.quantity);
  if (remainingScaled <= 0) return 0;
  const [rows] = await conn.execute(
    `SELECT * FROM ims_stock_allocations
      WHERE business_id = ? AND so_item_id = ? AND state = 'active'
      ORDER BY priority, created_at, id FOR UPDATE`,
    [input.businessId, input.sourceSoItemId],
  );
  let transferredScaled = 0;
  for (const allocation of rows as any[]) {
    if (remainingScaled <= 0) break;
    const outstandingScaled = Math.max(
      0,
      scaledQuantity(Number(allocation.qty_allocated)) - scaledQuantity(Number(allocation.qty_fulfilled)),
    );
    if (outstandingScaled === 0) continue;
    const moveScaled = Math.min(remainingScaled, outstandingScaled);
    const moveQuantity = moveScaled / QUANTITY_SCALE;
    if (moveScaled === outstandingScaled && Number(allocation.qty_fulfilled ?? 0) === 0) {
      await conn.execute(
        `UPDATE ims_stock_allocations
            SET so_id = ?, so_item_id = ?, revision = revision + 1
          WHERE id = ? AND business_id = ?`,
        [input.backorderSoId, input.backorderSoItemId, allocation.id, input.businessId],
      );
    } else {
      const receivedMoved = Math.min(Number(allocation.qty_received_assigned ?? 0), moveQuantity);
      await conn.execute(
        `UPDATE ims_stock_allocations
            SET qty_allocated = qty_allocated - ?,
                qty_received_assigned = GREATEST(0, qty_received_assigned - ?),
                revision = revision + 1
          WHERE id = ? AND business_id = ?`,
        [moveQuantity, receivedMoved, allocation.id, input.businessId],
      );
      await conn.execute(
        `INSERT INTO ims_stock_allocations
          (business_id, so_id, so_item_id, po_id, po_item_id, variant_id, location_id,
           qty_allocated, qty_received_assigned, qty_fulfilled, source_expected_date, promised_date,
           promise_status, state, priority, override_reason, risk_reason, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [input.businessId, input.backorderSoId, input.backorderSoItemId, allocation.po_id, allocation.po_item_id,
          allocation.variant_id, allocation.location_id, moveQuantity, receivedMoved,
          allocation.source_expected_date ?? null, allocation.promised_date ?? null, allocation.promise_status,
          allocation.priority, allocation.override_reason ?? null, allocation.risk_reason ?? null,
          allocation.created_by ?? null, allocation.created_by_name ?? null],
      );
    }
    remainingScaled -= moveScaled;
    transferredScaled += moveScaled;
  }
  return transferredScaled / QUANTITY_SCALE;
}

export async function transferStockAllocationsToSupplierBackorderLine(
  conn: AllocationConnection,
  input: { businessId: string; sourcePoItemId: number; backorderPoId: number; backorderPoItemId: number },
): Promise<number> {
  const [result] = await conn.execute(
    `UPDATE ims_stock_allocations
        SET po_id = ?, po_item_id = ?, promise_status = 'at_risk',
            risk_reason = 'Supplier shortfall moved allocated supply to a held backorder purchase order.',
            revision = revision + 1
      WHERE business_id = ? AND po_item_id = ? AND state = 'active'`,
    [input.backorderPoId, input.backorderPoItemId, input.businessId, input.sourcePoItemId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}