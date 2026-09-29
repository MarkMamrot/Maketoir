import { createHash } from 'node:crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import { StockAllocationConflict } from './stockAllocation/service';

const QUANTITY_SCALE = 10_000;

function quantity(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error('Stock quantity must be finite.');
  return Math.round(number * QUANTITY_SCALE) / QUANTITY_SCALE;
}

export type SalesOrderSourcingCandidate = {
  poItemId: number;
  poId: number;
  poNumber: string;
  supplierName: string | null;
  expectedDate: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  freeQuantity: number;
};

export type SalesOrderSourcingLine = {
  soItemId: number;
  variantId: string;
  sku: string | null;
  productName: string;
  ordered: number;
  outstanding: number;
  availableNow: number;
  allocatedIncoming: number;
  shortage: number;
  unsourced: number;
  isStockItem: boolean;
  candidates: SalesOrderSourcingCandidate[];
};

export type SalesOrderSourcingPreview = {
  soId: number;
  soNumber: string;
  status: string;
  locationId: number;
  locationName: string | null;
  lines: SalesOrderSourcingLine[];
  requiresReview: boolean;
};

export type SalesOrderSourcingChoice = {
  soItemId: number;
  poItemId: number;
  quantity: number;
  promisedDate?: string | null;
};

export type ConfirmSalesOrderSourcingInput = {
  businessId: string;
  soId: number;
  operationKey: string;
  expectedUpdatedAt?: string | null;
  choices: SalesOrderSourcingChoice[];
  acknowledgedUnsourcedSoItemIds: number[];
  actorId?: number | null;
  actorName?: string | null;
};

type Executor = { execute: (sql: string, params?: unknown[]) => Promise<any> };

type DemandRow = {
  so_item_id: number;
  variant_id: string;
  qty_ordered: number | string;
  qty_fulfilled: number | string | null;
  sku: string | null;
  product_name: string | null;
  is_stock_item: number;
  qty_on_hand: number | string | null;
  qty_committed: number | string | null;
};

type SupplyRow = {
  po_item_id: number;
  po_id: number;
  variant_id: string;
  qty_ordered: number | string;
  qty_received: number | string | null;
  po_number: string;
  supplier_name: string | null;
  expected_date: string | null;
};

async function loadSourcingPreview(
  executor: Executor,
  input: { businessId: string; soId: number; lock?: boolean },
): Promise<SalesOrderSourcingPreview> {
  const lock = input.lock ? ' FOR UPDATE' : '';
  const [[order]] = await executor.execute(
    `SELECT so.id, so.so_number, so.status, so.location_id, so.so_type, so.updated_at, location.name AS location_name
       FROM ims_sales_orders so
      LEFT JOIN ims_locations location ON location.id = so.location_id AND location.business_id = so.business_id
      WHERE so.id = ? AND so.business_id = ?${lock}`,
    [input.soId, input.businessId],
  );
  if (!order) throw new StockAllocationConflict('Sales order was not found.');
  if (String(order.so_type) === 'online') {
    throw new StockAllocationConflict('Online sales orders use reserved available stock and cannot use incoming sourcing review.');
  }

  const [demandRows] = await executor.execute(
    `SELECT soi.id AS so_item_id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled,
            variant.sku, product.name AS product_name, COALESCE(product.is_stock_item, 1) AS is_stock_item,
            COALESCE(stock.qty_on_hand, 0) AS qty_on_hand, COALESCE(stock.qty_committed, 0) AS qty_committed
       FROM ims_sales_order_items soi
      JOIN ims_product_variants variant ON variant.variant_id = soi.variant_id AND variant.business_id = soi.business_id
      JOIN ims_products product ON product.product_id = variant.product_id AND product.business_id = soi.business_id
      LEFT JOIN ims_stock stock ON stock.variant_id = soi.variant_id AND stock.location_id = ? AND stock.business_id = soi.business_id
      WHERE soi.so_id = ? AND soi.business_id = ?
      ORDER BY soi.id${lock}`,
    [order.location_id, input.soId, input.businessId],
  ) as [DemandRow[]];

  const variantIds = [...new Set(demandRows.filter(row => Number(row.is_stock_item) !== 0).map(row => String(row.variant_id)))];
  let supplyRows: SupplyRow[] = [];
  let allocationRows: Array<{ so_item_id: number; po_item_id: number; qty_allocated: number | string; qty_fulfilled: number | string; qty_received_assigned: number | string }> = [];
  if (variantIds.length > 0) {
    const placeholders = variantIds.map(() => '?').join(',');
    [supplyRows] = await executor.execute(
            `SELECT item.id AS po_item_id, item.po_id, item.variant_id, item.qty_ordered, item.qty_received,
              po.po_number, COALESCE(supplier.name, NULLIF(po.supplier_name_raw, '')) AS supplier_name,
              po.expected_date
         FROM ims_purchase_order_items item
         JOIN ims_purchase_orders po ON po.id = item.po_id AND po.business_id = item.business_id
         LEFT JOIN ims_contacts supplier ON supplier.id = po.supplier_id AND supplier.business_id = po.business_id
        WHERE item.business_id = ? AND item.variant_id IN (${placeholders})
          AND po.location_id = ? AND po.status IN ('confirmed','partially_received')
        ORDER BY po.expected_date IS NULL, po.expected_date, po.order_date, po.id, item.id${lock}`,
      [input.businessId, ...variantIds, order.location_id],
    );
    [allocationRows] = await executor.execute(
      `SELECT so_item_id, po_item_id, qty_allocated, qty_fulfilled, qty_received_assigned
         FROM ims_stock_allocations
        WHERE business_id = ? AND state = 'active' AND (so_id = ? OR variant_id IN (${placeholders}))${lock}`,
      [input.businessId, input.soId, ...variantIds],
    );
  }

  const allocatedByDemand = new Map<number, number>();
  const allocatedBySupply = new Map<number, number>();
  for (const allocation of allocationRows) {
    allocatedByDemand.set(
      Number(allocation.so_item_id),
      quantity((allocatedByDemand.get(Number(allocation.so_item_id)) ?? 0) + Math.max(0, Number(allocation.qty_allocated) - Number(allocation.qty_fulfilled))),
    );
    allocatedBySupply.set(
      Number(allocation.po_item_id),
      quantity((allocatedBySupply.get(Number(allocation.po_item_id)) ?? 0) + Math.max(0, Number(allocation.qty_allocated) - Number(allocation.qty_received_assigned))),
    );
  }

  const outstandingByVariant = new Map<string, number>();
  for (const row of demandRows) {
    if (Number(row.is_stock_item) === 0) continue;
    const variantId = String(row.variant_id);
    outstandingByVariant.set(variantId, quantity((outstandingByVariant.get(variantId) ?? 0) + Math.max(0, Number(row.qty_ordered) - Number(row.qty_fulfilled ?? 0))));
  }
  const availablePool = new Map<string, number>();
  for (const row of demandRows) {
    const variantId = String(row.variant_id);
    if (availablePool.has(variantId)) continue;
    const orderOutstanding = outstandingByVariant.get(variantId) ?? 0;
    const otherCommitted = String(order.status) === 'draft'
      ? Number(row.qty_committed ?? 0)
      : Math.max(0, Number(row.qty_committed ?? 0) - orderOutstanding);
    availablePool.set(variantId, quantity(Math.max(0, Number(row.qty_on_hand ?? 0) - otherCommitted)));
  }

  const lines = demandRows.map(row => {
    const isStockItem = Number(row.is_stock_item) !== 0;
    const outstanding = quantity(Math.max(0, Number(row.qty_ordered) - Number(row.qty_fulfilled ?? 0)));
    const variantId = String(row.variant_id);
    const pool = isStockItem ? availablePool.get(variantId) ?? 0 : outstanding;
    const availableNow = quantity(Math.min(outstanding, pool));
    if (isStockItem) availablePool.set(variantId, quantity(Math.max(0, pool - availableNow)));
    const allocatedIncoming = isStockItem ? quantity(allocatedByDemand.get(Number(row.so_item_id)) ?? 0) : 0;
    const shortage = isStockItem ? quantity(Math.max(0, outstanding - availableNow)) : 0;
    const unsourced = isStockItem ? quantity(Math.max(0, shortage - allocatedIncoming)) : 0;
    const candidates = isStockItem ? supplyRows
      .filter(supply => String(supply.variant_id) === variantId)
      .map(supply => ({
        poItemId: Number(supply.po_item_id),
        poId: Number(supply.po_id),
        poNumber: String(supply.po_number),
        supplierName: supply.supplier_name ?? null,
        expectedDate: supply.expected_date ?? null,
        orderedQuantity: quantity(supply.qty_ordered),
        receivedQuantity: quantity(supply.qty_received),
        freeQuantity: quantity(Math.max(0, Number(supply.qty_ordered) - Number(supply.qty_received ?? 0) - (allocatedBySupply.get(Number(supply.po_item_id)) ?? 0))),
      }))
      .filter(candidate => candidate.freeQuantity > 0) : [];
    return {
      soItemId: Number(row.so_item_id), variantId, sku: row.sku ?? null,
      productName: row.product_name ?? 'Product', ordered: quantity(row.qty_ordered), outstanding,
      availableNow, allocatedIncoming, shortage, unsourced, isStockItem, candidates,
    };
  });

  return {
    soId: Number(order.id), soNumber: String(order.so_number), status: String(order.status),
    locationId: Number(order.location_id), locationName: order.location_name ?? null, lines,
    requiresReview: String(order.status) === 'draft' && lines.some(line => line.unsourced > 0),
  };
}

export async function previewSalesOrderSourcing(input: { businessId: string; soId: number }): Promise<SalesOrderSourcingPreview> {
  return loadSourcingPreview(getIMSPool(), input);
}

function requestHash(input: ConfirmSalesOrderSourcingInput): string {
  const canonical = {
    soId: Number(input.soId),
    choices: input.choices.map(choice => ({
      soItemId: Number(choice.soItemId), poItemId: Number(choice.poItemId),
      quantity: quantity(choice.quantity), promisedDate: choice.promisedDate?.trim() || null,
    })).sort((left, right) => left.soItemId - right.soItemId || left.poItemId - right.poItemId),
    acknowledgedUnsourcedSoItemIds: [...new Set(input.acknowledgedUnsourcedSoItemIds.map(Number))].sort((left, right) => left - right),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function sameRevision(actual: unknown, expected: string | null | undefined): boolean {
  if (!expected) return true;
  const actualTime = new Date(String(actual ?? '')).getTime();
  const expectedTime = new Date(expected).getTime();
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
}

export async function confirmSalesOrderWithSourcing(input: ConfirmSalesOrderSourcingInput): Promise<{
  replayed: boolean;
  allocationIds: number[];
  preview: SalesOrderSourcingPreview;
}> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid confirmation operation key is required.');
  const hash = requestHash(input);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [[existingOperation]] = await connection.execute(
      `SELECT id, request_hash, state, after_header_json
         FROM ims_order_amendment_operations
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    if (existingOperation) {
      if (String(existingOperation.request_hash) !== hash) throw new StockAllocationConflict('This confirmation key was already used with different sourcing choices.');
      if (String(existingOperation.state) !== 'complete') throw new StockAllocationConflict('This confirmation is already being processed.');
      const saved = typeof existingOperation.after_header_json === 'string'
        ? JSON.parse(existingOperation.after_header_json) : existingOperation.after_header_json;
      await connection.commit();
      return { replayed: true, allocationIds: saved?.allocationIds ?? [], preview: saved?.preview };
    }

    const [[order]] = await connection.execute(
      `SELECT * FROM ims_sales_orders WHERE id = ? AND business_id = ? FOR UPDATE`,
      [input.soId, input.businessId],
    );
    if (!order) throw new StockAllocationConflict('Sales order was not found.');
    if (String(order.status) !== 'draft') throw new StockAllocationConflict('Only a Draft sales order can use sourcing review.');
    if (!sameRevision(order.updated_at, input.expectedUpdatedAt)) {
      throw new StockAllocationConflict('This sales order changed after you opened it. Refresh and review the latest availability.');
    }

    const [orderItems] = await connection.execute(
      `SELECT id, variant_id, qty_ordered FROM ims_sales_order_items
        WHERE so_id = ? AND business_id = ? ORDER BY id FOR UPDATE`,
      [input.soId, input.businessId],
    );
    for (const item of orderItems) {
      await connection.execute(
        `INSERT IGNORE INTO ims_stock (business_id, variant_id, location_id) VALUES (?, ?, ?)`,
        [input.businessId, item.variant_id, order.location_id],
      );
    }

    const preview = await loadSourcingPreview(connection, { businessId: input.businessId, soId: input.soId, lock: true });
    const acknowledged = new Set(input.acknowledgedUnsourcedSoItemIds.map(Number));
    const choicesByLine = new Map<number, SalesOrderSourcingChoice[]>();
    const choiceKeys = new Set<string>();
    for (const choice of input.choices) {
      if (!(quantity(choice.quantity) > 0)) throw new StockAllocationConflict('Allocation quantities must be greater than zero.');
      const soItemId = Number(choice.soItemId);
      const poItemId = Number(choice.poItemId);
      if (!preview.lines.some(line => line.soItemId === soItemId)) throw new StockAllocationConflict('Selected sales order line is no longer available.');
      const choiceKey = `${soItemId}:${poItemId}`;
      if (choiceKeys.has(choiceKey)) throw new StockAllocationConflict('The same incoming supply was selected more than once for a sales order line.');
      choiceKeys.add(choiceKey);
      choicesByLine.set(soItemId, [...(choicesByLine.get(soItemId) ?? []), choice]);
    }

    const selectedSupply = new Map<number, number>();
    for (const line of preview.lines) {
      const choices = choicesByLine.get(line.soItemId) ?? [];
      const allocated = quantity(choices.reduce((sum, choice) => sum + Number(choice.quantity), 0));
      if (allocated > line.unsourced) throw new StockAllocationConflict(`Incoming allocation exceeds the ${line.unsourced} unit shortage for ${line.sku || line.productName}.`);
      if (allocated < line.unsourced && !acknowledged.has(line.soItemId)) {
        throw new StockAllocationConflict(`Choose incoming supply or explicitly leave the remaining ${line.sku || line.productName} quantity unsourced.`);
      }
      for (const choice of choices) {
        const candidate = line.candidates.find(item => item.poItemId === Number(choice.poItemId));
        if (!candidate) throw new StockAllocationConflict(`Selected incoming supply is no longer eligible for ${line.sku || line.productName}.`);
        selectedSupply.set(candidate.poItemId, quantity((selectedSupply.get(candidate.poItemId) ?? 0) + Number(choice.quantity)));
      }
    }
    for (const [poItemId, selected] of selectedSupply) {
      const candidate = preview.lines.flatMap(line => line.candidates).find(item => item.poItemId === poItemId);
      if (!candidate || selected > candidate.freeQuantity) throw new StockAllocationConflict('Selected incoming quantity is no longer available. Refresh the sourcing review.');
    }

    const [operationResult] = await connection.execute(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'sales_order', ?, 'draft', 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, hash, input.soId, JSON.stringify(order), input.actorId ?? null, input.actorName ?? null],
    );

    for (const line of preview.lines) {
      if (!line.isStockItem) continue;
      const item = orderItems.find((row: any) => Number(row.id) === line.soItemId);
      if (!item) throw new StockAllocationConflict('Sales order line changed during sourcing review.');
      await connection.execute(
        `UPDATE ims_stock SET qty_committed = qty_committed + ?
          WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [item.qty_ordered, input.businessId, line.variantId, order.location_id],
      );
      const [[stock]] = await connection.execute(
        `SELECT qty_on_hand FROM ims_stock
          WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [input.businessId, line.variantId, order.location_id],
      );
      await connection.execute(
        `INSERT INTO ims_stock_movements
          (business_id, variant_id, location_id, movement_type, channel, reference_type, reference_id, qty_change, qty_after_soh)
         VALUES (?, ?, ?, 'so_confirmed', ?, 'sales_order', ?, ?, ?)`,
        [input.businessId, line.variantId, order.location_id, order.so_type === 'online' ? 'online' : 'wholesale', input.soId, item.qty_ordered, Number(stock?.qty_on_hand ?? 0)],
      );
    }

    const allocationIds: number[] = [];
    let allocationIndex = 0;
    for (const line of preview.lines) {
      for (const choice of choicesByLine.get(line.soItemId) ?? []) {
        const candidate = line.candidates.find(item => item.poItemId === Number(choice.poItemId))!;
        const allocationRequest = {
          action: 'allocate', soItemId: line.soItemId, poItemId: candidate.poItemId,
          quantity: quantity(choice.quantity), promisedDate: choice.promisedDate?.trim() || null,
          priority: 0, overrideReason: null,
        };
        const allocationHash = createHash('sha256').update(JSON.stringify(allocationRequest)).digest('hex');
        const allocationOperationKey = `${operationKey}:allocation:${allocationIndex++}`;
        const [allocationOperation] = await connection.execute(
          `INSERT INTO ims_stock_allocation_operations
            (business_id, operation_key, request_hash, action, state, request_json, actor_id, actor_name)
           VALUES (?, ?, ?, 'allocate', 'processing', ?, ?, ?)`,
          [input.businessId, allocationOperationKey, allocationHash, JSON.stringify(allocationRequest), input.actorId ?? null, input.actorName ?? null],
        );
        const [allocation] = await connection.execute(
          `INSERT INTO ims_stock_allocations
            (business_id, so_id, so_item_id, po_id, po_item_id, variant_id, location_id, qty_allocated,
             source_expected_date, promised_date, promise_status, priority, created_by, created_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [input.businessId, input.soId, line.soItemId, candidate.poId, candidate.poItemId, line.variantId,
           order.location_id, quantity(choice.quantity), candidate.expectedDate, choice.promisedDate?.trim() || null,
           choice.promisedDate?.trim() ? 'confirmed' : 'unpromised', input.actorId ?? null, input.actorName ?? null],
        );
        const allocationId = Number(allocation.insertId);
        allocationIds.push(allocationId);
        await connection.execute(
          `UPDATE ims_stock_allocation_operations
              SET allocation_id = ?, state = 'complete', response_json = ?, completed_at = NOW()
            WHERE id = ? AND business_id = ?`,
          [allocationId, JSON.stringify({ allocationId }), allocationOperation.insertId, input.businessId],
        );
      }
    }

    await connection.execute(`UPDATE ims_sales_orders SET status = 'confirmed' WHERE id = ? AND business_id = ?`, [input.soId, input.businessId]);
    const responsePreview = {
      ...preview,
      status: 'confirmed',
      lines: preview.lines.map(line => {
        const added = quantity((choicesByLine.get(line.soItemId) ?? []).reduce((sum, choice) => sum + Number(choice.quantity), 0));
        return { ...line, allocatedIncoming: quantity(line.allocatedIncoming + added), unsourced: quantity(Math.max(0, line.unsourced - added)) };
      }),
    };
    const response = { allocationIds, preview: responsePreview };
    await connection.execute(
      `UPDATE ims_order_amendment_operations
          SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE id = ? AND business_id = ?`,
      [JSON.stringify(response), operationResult.insertId, input.businessId],
    );
    await connection.commit();
    return { replayed: false, ...response };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
