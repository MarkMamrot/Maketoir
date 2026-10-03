import { getIMSPool } from '@/services/IMSMySQLService';
import {
  buildStockAllocationRequestHash,
  StockAllocationConflict,
  type CreateStockAllocationInput,
} from './service';

const QUANTITY_SCALE = 10_000;

export type BatchStockAllocation = Pick<CreateStockAllocationInput,
  'soItemId' | 'poItemId' | 'quantity' | 'promisedDate' | 'priority' | 'overrideReason'>;

export type CreateStockAllocationBatchInput = {
  businessId: string;
  operationKey: string;
  allocations: BatchStockAllocation[];
  actorId?: number | null;
  actorName?: string | null;
};

const scaled = (value: number) => Math.round(value * QUANTITY_SCALE);

export async function createStockAllocationBatch(input: CreateStockAllocationBatchInput): Promise<{
  allocationIds: number[];
  replayed: boolean;
}> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 150) throw new Error('A valid batch allocation operation key is required.');
  if (!input.businessId) throw new Error('Business context is required.');
  if (!Array.isArray(input.allocations) || input.allocations.length === 0 || input.allocations.length > 100) {
    throw new Error('Choose between 1 and 100 allocation suggestions.');
  }
  input.allocations.forEach(allocation => {
    if (!Number.isInteger(allocation.soItemId) || !Number.isInteger(allocation.poItemId)) {
      throw new Error('Valid sales and purchase order lines are required.');
    }
    if (!Number.isFinite(allocation.quantity) || scaled(allocation.quantity) <= 0) {
      throw new Error('Allocation quantities must be greater than zero.');
    }
  });

  const soItemIds = [...new Set(input.allocations.map(row => row.soItemId))].sort((a, b) => a - b);
  const poItemIds = [...new Set(input.allocations.map(row => row.poItemId))].sort((a, b) => a - b);
  const soPlaceholders = soItemIds.map(() => '?').join(',');
  const poPlaceholders = poItemIds.map(() => '?').join(',');
  const connection = await getIMSPool().getConnection();

  try {
    await connection.beginTransaction();
    const [soRows] = await connection.execute<any[]>(
      `SELECT soi.id, soi.so_id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled,
              so.location_id, so.status, so.so_type
         FROM ims_sales_order_items soi
         JOIN ims_sales_orders so ON so.id = soi.so_id AND so.business_id = soi.business_id
        WHERE soi.business_id = ? AND soi.id IN (${soPlaceholders})
        ORDER BY soi.id FOR UPDATE`,
      [input.businessId, ...soItemIds],
    );
    const [poRows] = await connection.execute<any[]>(
      `SELECT poi.id, poi.po_id, poi.variant_id, poi.qty_ordered, poi.qty_received,
              po.location_id, po.status, po.expected_date
         FROM ims_purchase_order_items poi
         JOIN ims_purchase_orders po ON po.id = poi.po_id AND po.business_id = poi.business_id
        WHERE poi.business_id = ? AND poi.id IN (${poPlaceholders})
        ORDER BY poi.id FOR UPDATE`,
      [input.businessId, ...poItemIds],
    );
    if (soRows.length !== soItemIds.length || poRows.length !== poItemIds.length) {
      throw new StockAllocationConflict('A reviewed sales or purchase order line is no longer available. Refresh suggestions.');
    }

    const [activeRows] = await connection.execute<any[]>(
      `SELECT so_item_id, po_item_id, qty_allocated, qty_received_assigned, qty_fulfilled
         FROM ims_stock_allocations
        WHERE business_id = ? AND state = 'active'
          AND (so_item_id IN (${soPlaceholders}) OR po_item_id IN (${poPlaceholders}))
        ORDER BY id FOR UPDATE`,
      [input.businessId, ...soItemIds, ...poItemIds],
    );
    const soAllocated = new Map<number, number>();
    const poAllocated = new Map<number, number>();
    for (const row of activeRows) {
      const soItemId = Number(row.so_item_id);
      const poItemId = Number(row.po_item_id);
      soAllocated.set(soItemId, (soAllocated.get(soItemId) ?? 0)
        + scaled(Number(row.qty_allocated)) - scaled(Number(row.qty_fulfilled ?? 0)));
      poAllocated.set(poItemId, (poAllocated.get(poItemId) ?? 0)
        + scaled(Number(row.qty_allocated)) - scaled(Number(row.qty_received_assigned ?? 0)));
    }
    const soById = new Map(soRows.map(row => [Number(row.id), row]));
    const poById = new Map(poRows.map(row => [Number(row.id), row]));
    const allocationIds: number[] = [];
    let replayedCount = 0;

    for (const [index, allocation] of input.allocations.entries()) {
      const soItem = soById.get(allocation.soItemId)!;
      const poItem = poById.get(allocation.poItemId)!;
      if (String(soItem.so_type) === 'online' || !['confirmed', 'partially_fulfilled', 'backordered'].includes(String(soItem.status))) {
        throw new StockAllocationConflict('Reviewed demand is no longer eligible for incoming allocation. Refresh suggestions.');
      }
      if (!['confirmed', 'partially_received'].includes(String(poItem.status))) {
        throw new StockAllocationConflict('Reviewed incoming supply is no longer eligible. Refresh suggestions.');
      }
      if (String(soItem.variant_id) !== String(poItem.variant_id) || Number(soItem.location_id) !== Number(poItem.location_id)) {
        throw new StockAllocationConflict('Reviewed demand and supply no longer match. Refresh suggestions.');
      }

      const childInput: CreateStockAllocationInput = {
        businessId: input.businessId,
        operationKey: `${operationKey}:${index}`,
        ...allocation,
        actorId: input.actorId,
        actorName: input.actorName,
      };
      const requestHash = buildStockAllocationRequestHash(childInput);
      const [operationRows] = await connection.execute<any[]>(
        `SELECT id, request_hash, state, response_json
           FROM ims_stock_allocation_operations
          WHERE business_id = ? AND operation_key = ?
          LIMIT 1 FOR UPDATE`,
        [input.businessId, childInput.operationKey],
      );
      const existing = operationRows[0];
      if (existing) {
        if (String(existing.request_hash) !== requestHash || existing.state !== 'complete') {
          throw new StockAllocationConflict('This batch allocation operation conflicts with an earlier request.');
        }
        const response = typeof existing.response_json === 'string'
          ? JSON.parse(existing.response_json)
          : existing.response_json;
        if (!response?.allocationId) throw new StockAllocationConflict('A completed allocation has no stored result.');
        allocationIds.push(Number(response.allocationId));
        replayedCount += 1;
        continue;
      }

      const requested = scaled(allocation.quantity);
      const soFree = scaled(Number(soItem.qty_ordered) - Number(soItem.qty_fulfilled ?? 0))
        - (soAllocated.get(allocation.soItemId) ?? 0);
      if (requested > soFree) {
        throw new StockAllocationConflict('Reviewed allocation exceeds demand still awaiting supply. Refresh suggestions.');
      }
      const poFree = scaled(Number(poItem.qty_ordered) - Number(poItem.qty_received ?? 0))
        - (poAllocated.get(allocation.poItemId) ?? 0);
      if (requested > poFree) {
        throw new StockAllocationConflict('Reviewed allocation exceeds incoming supply still free. Refresh suggestions.');
      }
      soAllocated.set(allocation.soItemId, (soAllocated.get(allocation.soItemId) ?? 0) + requested);
      poAllocated.set(allocation.poItemId, (poAllocated.get(allocation.poItemId) ?? 0) + requested);

      const request = {
        action: 'allocate', soItemId: allocation.soItemId, poItemId: allocation.poItemId,
        quantity: requested / QUANTITY_SCALE, promisedDate: allocation.promisedDate?.trim() || null,
        priority: Math.trunc(Number(allocation.priority ?? 0)), overrideReason: allocation.overrideReason?.trim() || null,
      };
      const [operationResult] = await connection.execute<any>(
        `INSERT INTO ims_stock_allocation_operations
          (business_id, operation_key, request_hash, action, state, request_json, actor_id, actor_name)
         VALUES (?, ?, ?, 'allocate', 'processing', ?, ?, ?)`,
        [input.businessId, childInput.operationKey, requestHash, JSON.stringify(request), input.actorId ?? null, input.actorName ?? null],
      );
      const [allocationResult] = await connection.execute<any>(
        `INSERT INTO ims_stock_allocations
          (business_id, so_id, so_item_id, po_id, po_item_id, variant_id, location_id, qty_allocated,
           source_expected_date, promised_date, promise_status, priority, override_reason, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, soItem.so_id, allocation.soItemId, poItem.po_id, allocation.poItemId,
          soItem.variant_id, soItem.location_id, requested / QUANTITY_SCALE, poItem.expected_date ?? null,
          request.promisedDate, request.promisedDate ? 'confirmed' : 'unpromised', request.priority,
          request.overrideReason, input.actorId ?? null, input.actorName ?? null],
      );
      const allocationId = Number(allocationResult.insertId);
      allocationIds.push(allocationId);
      await connection.execute(
        `UPDATE ims_stock_allocation_operations
            SET allocation_id = ?, state = 'complete', response_json = ?, completed_at = NOW()
          WHERE id = ? AND business_id = ?`,
        [allocationId, JSON.stringify({ allocationId }), operationResult.insertId, input.businessId],
      );
    }

    await connection.commit();
    return { allocationIds, replayed: replayedCount === input.allocations.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}