import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import { commercialLineKey } from '../backorders/domain';
import { getOrderTransferConflicts, type OrderTransferDocument } from './domain';

const QUANTITY_SCALE = 10_000;
const INCOMING_STATUSES = new Set(['confirmed', 'partially_received', 'backordered']);

export class PurchaseOrderTransferConflict extends Error {
  readonly code = 'purchase_order_transfer_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'PurchaseOrderTransferConflict';
  }
}

export type PurchaseOrderTransferLineInput = {
  sourceItemId: number;
  quantity: number;
  allocations: Array<{ allocationId: number; revision: number; quantity: number }>;
};

export type PurchaseOrderTransferResult = {
  replayed: boolean;
  sourceOrderId: number;
  targetOrderId: number;
  targetOrderNumber: string;
  sourceStatus: string;
  targetStatus: string;
  movedLines: Array<{
    sourceItemId: number;
    targetItemId: number;
    variantId: string;
    quantity: number;
    protectedQuantity: number;
  }>;
  variantIds: string[];
};

type PurchaseOrderRow = {
  id: number;
  po_number: string;
  business_id: string;
  status: string;
  supplier_id: number | null;
  location_id: number;
  currency_code: string;
  exchange_rate: number | string | null;
  tax_treatment: 'ex_tax' | 'inc_tax' | 'no_tax';
  tax_code: string | null;
  payment_terms: string | null;
  supplier_invoice_number: string | null;
  is_historical: number | null;
  cin7_order_id: string | null;
  xero_bill_id: string | null;
  has_payments: number | string;
  freight: number | string | null;
  discount: number | string | null;
  updated_at: string | Date | null;
  expected_date: string | Date | null;
};

type PurchaseOrderItemRow = {
  id: number;
  business_id: string;
  po_id: number;
  variant_id: string;
  qty_ordered: number | string;
  qty_received: number | string;
  unit_cost: number | string;
  discount_pct: number | string | null;
  tax_rate: number | string | null;
  line_total: number | string;
  notes: string | null;
  is_stock_item: number | string | null;
};

function scaled(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new PurchaseOrderTransferConflict(`${label} must be a finite number.`);
  return Math.round(value * QUANTITY_SCALE);
}

function quantity(value: number): number {
  return value / QUANTITY_SCALE;
}

function assertRevision(actual: unknown, expected: string | null | undefined, label: string): void {
  if (!expected) return;
  const actualTime = actual instanceof Date ? actual.getTime() : new Date(String(actual ?? '')).getTime();
  const expectedTime = new Date(expected).getTime();
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime) || actualTime !== expectedTime) {
    throw new PurchaseOrderTransferConflict(`${label} changed after this preview. Refresh and review the latest order.`);
  }
}

function asTransferDocument(order: PurchaseOrderRow): OrderTransferDocument {
  return {
    id: Number(order.id), kind: 'purchase_order', businessId: String(order.business_id),
    contactId: order.supplier_id == null ? null : Number(order.supplier_id),
    locationId: Number(order.location_id), currencyCode: String(order.currency_code ?? 'AUD'),
    exchangeRate: Number(order.exchange_rate ?? 1), taxTreatment: String(order.tax_treatment ?? 'ex_tax'),
    taxCode: order.tax_code ?? null, paymentTerms: order.payment_terms ?? null,
    externalReference: order.supplier_invoice_number ?? null, status: String(order.status),
    hasPayments: Boolean(Number(order.has_payments ?? 0)), xeroDocumentId: order.xero_bill_id ?? null,
    xeroDocumentStatus: order.xero_bill_id ? 'UNKNOWN' : null,
    commerciallyEditable: !Number(order.is_historical ?? 0) && !order.cin7_order_id,
  };
}

function lineKey(item: PurchaseOrderItemRow): string {
  return commercialLineKey({
    variantId: item.variant_id, unitAmount: Number(item.unit_cost),
    discountPct: Number(item.discount_pct ?? 0), taxRate: Number(item.tax_rate ?? 0), notes: item.notes,
  });
}

function lineTotal(ordered: number, item: PurchaseOrderItemRow): number {
  return Math.round(ordered * Number(item.unit_cost) * (1 - Number(item.discount_pct ?? 0) / 100) * 100) / 100;
}

function calculateTotals(items: PurchaseOrderItemRow[], order: PurchaseOrderRow) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const item of items) {
    const value = Number(item.qty_ordered) * Number(item.unit_cost) * (1 - Number(item.discount_pct ?? 0) / 100);
    const rate = Number(item.tax_rate ?? 0);
    if (order.tax_treatment === 'inc_tax' && rate > 0) {
      const exTax = value / (1 + rate);
      subtotal += Math.round(exTax * 100) / 100;
      taxAmount += Math.round((value - exTax) * 100) / 100;
    } else {
      subtotal += value;
      if (order.tax_treatment === 'ex_tax') taxAmount += Math.round(value * rate * 100) / 100;
    }
  }
  subtotal = Math.round(subtotal * 100) / 100;
  taxAmount = order.tax_treatment === 'no_tax' ? 0 : Math.round(taxAmount * 100) / 100;
  return {
    subtotal, taxAmount,
    totalAmount: Math.round((subtotal + taxAmount + Number(order.freight ?? 0) - Number(order.discount ?? 0)) * 100) / 100,
  };
}

function canonicalLines(lines: PurchaseOrderTransferLineInput[]) {
  return lines.map(line => ({
    sourceItemId: Number(line.sourceItemId),
    quantity: quantity(scaled(Number(line.quantity), 'Move quantity')),
    allocations: (line.allocations ?? []).map(allocation => ({
      allocationId: Number(allocation.allocationId), revision: Number(allocation.revision),
      quantity: quantity(scaled(Number(allocation.quantity), 'Promise quantity')),
    })).sort((left, right) => left.allocationId - right.allocationId),
  })).sort((left, right) => left.sourceItemId - right.sourceItemId);
}

function newTargetStatus(sourceStatus: string): string {
  if (sourceStatus === 'draft' || sourceStatus === 'backordered') return sourceStatus;
  return 'confirmed';
}

async function createTransferTarget(conn: any, businessId: string, sourceOrder: PurchaseOrderRow) {
  const year = new Date().getFullYear();
  const [[numberRow]] = await conn.execute<any[]>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS max_seq
       FROM ims_purchase_orders
      WHERE business_id = ? AND po_number LIKE ?`,
    [businessId, `PO-${year}-%`],
  );
  const poNumber = `PO-${year}-${String(Number(numberRow?.max_seq ?? 0) + 1).padStart(4, '0')}`;
  const status = newTargetStatus(String(sourceOrder.status));
  const [insertResult] = await conn.execute<any>(
    `INSERT INTO ims_purchase_orders
      (business_id, po_number, supplier_id, location_id, status, order_date, expected_date, notes,
       supplier_invoice_number, payment_terms, tax_treatment, tax_code, currency_code, exchange_rate,
       freight, discount, subtotal, tax_amount, total_amount)
     VALUES (?, ?, ?, ?, ?, CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
    [businessId, poNumber, sourceOrder.supplier_id ?? null, sourceOrder.location_id, status,
      sourceOrder.expected_date ?? null, `Items moved from ${sourceOrder.po_number}`,
      sourceOrder.supplier_invoice_number ?? null, sourceOrder.payment_terms ?? null,
      sourceOrder.tax_treatment ?? 'ex_tax', sourceOrder.tax_code ?? null,
      sourceOrder.currency_code ?? 'AUD', Number(sourceOrder.exchange_rate ?? 1)],
  );
  return {
    ...sourceOrder,
    id: Number(insertResult.insertId),
    po_number: poNumber,
    status,
    is_historical: 0,
    cin7_order_id: null,
    xero_bill_id: null,
    has_payments: 0,
    freight: 0,
    discount: 0,
    updated_at: null,
  } as PurchaseOrderRow;
}

export async function transferPurchaseOrderItems(input: {
  businessId: string;
  sourceOrderId: number;
  targetOrderId?: number | null;
  createTarget?: boolean;
  lines: PurchaseOrderTransferLineInput[];
  operationKey: string;
  expectedSourceUpdatedAt?: string | null;
  expectedTargetUpdatedAt?: string | null;
  actorId?: number | null;
  actorName?: string | null;
}): Promise<PurchaseOrderTransferResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 150) throw new PurchaseOrderTransferConflict('A valid operation key is required.');
  const createTarget = input.createTarget === true;
  if (!Number.isInteger(input.sourceOrderId) || input.sourceOrderId <= 0) {
    throw new PurchaseOrderTransferConflict('Choose a valid source Purchase Order.');
  }
  if (!createTarget && (!Number.isInteger(input.targetOrderId) || Number(input.targetOrderId) <= 0
    || input.sourceOrderId === input.targetOrderId)) {
    throw new PurchaseOrderTransferConflict('Choose a different valid destination Purchase Order.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new PurchaseOrderTransferConflict('Select at least one quantity to move.');
  const lines = canonicalLines(input.lines);
  if (new Set(lines.map(line => line.sourceItemId)).size !== lines.length) throw new PurchaseOrderTransferConflict('Each source line may appear only once.');
  for (const line of lines) {
    if (!Number.isInteger(line.sourceItemId) || line.sourceItemId <= 0 || line.quantity <= 0) {
      throw new PurchaseOrderTransferConflict('Move line IDs and quantities must be positive.');
    }
    if (new Set(line.allocations.map(allocation => allocation.allocationId)).size !== line.allocations.length
      || line.allocations.some(allocation => !Number.isInteger(allocation.allocationId) || allocation.allocationId <= 0
        || !Number.isInteger(allocation.revision) || allocation.revision < 0 || allocation.quantity <= 0)) {
      throw new PurchaseOrderTransferConflict('Each selected customer promise must have a valid unique ID, revision, and quantity.');
    }
    if (line.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) > line.quantity + 0.00005) {
      throw new PurchaseOrderTransferConflict('Selected customer promises cannot exceed the moved quantity.');
    }
  }
  const requestHash = createHash('sha256').update(JSON.stringify({
    sourceOrderId: input.sourceOrderId, destination: createTarget ? 'new' : Number(input.targetOrderId), lines,
  })).digest('hex');
  const conn = await getIMSPool().getConnection();
  const numberLockName = `ims:${input.businessId}:po:number`;
  let numberLockAcquired = false;
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.execute<any[]>(
      `SELECT request_hash, state, after_header_json FROM ims_order_amendment_operations
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash) throw new PurchaseOrderTransferConflict('This move key was already used with different quantities.');
      if (String(existing.state) !== 'complete') throw new PurchaseOrderTransferConflict('This move is already being processed. Refresh before trying again.');
      const after = typeof existing.after_header_json === 'string' ? JSON.parse(existing.after_header_json) : existing.after_header_json;
      if (!after?.transferResult) throw new PurchaseOrderTransferConflict('The completed move result could not be read.');
      await conn.commit();
      return { ...after.transferResult, replayed: true };
    }

    const orderIds = createTarget
      ? [input.sourceOrderId]
      : [input.sourceOrderId, Number(input.targetOrderId)].sort((left, right) => left - right);
    const orderPlaceholders = orderIds.map(() => '?').join(', ');
    const [orders] = await conn.execute<PurchaseOrderRow[]>(
      `SELECT po.*,
              EXISTS(SELECT 1 FROM ims_purchase_order_payments payment
                       WHERE payment.business_id = po.business_id AND payment.po_id = po.id) AS has_payments
         FROM ims_purchase_orders po
        WHERE po.business_id = ? AND po.id IN (${orderPlaceholders}) ORDER BY po.id FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (orders.length !== orderIds.length) throw new PurchaseOrderTransferConflict('One or more Purchase Orders were not found.');
    const sourceOrder = orders.find(order => Number(order.id) === input.sourceOrderId)!;
    assertRevision(sourceOrder.updated_at, input.expectedSourceUpdatedAt, 'The source Purchase Order');
    if (createTarget) {
      const [[lockResult]] = await conn.execute<any[]>(`SELECT GET_LOCK(?, 10) AS acquired`, [numberLockName]);
      if (Number(lockResult?.acquired) !== 1) {
        throw new PurchaseOrderTransferConflict('Could not allocate a new Purchase Order number. Please retry.');
      }
      numberLockAcquired = true;
    }
    const targetOrder = createTarget
      ? await createTransferTarget(conn, input.businessId, sourceOrder)
      : orders.find(order => Number(order.id) === Number(input.targetOrderId))!;
    const targetOrderId = Number(targetOrder.id);
    if (!createTarget) assertRevision(targetOrder.updated_at, input.expectedTargetUpdatedAt, 'The destination Purchase Order');
    const conflicts = getOrderTransferConflicts(asTransferDocument(sourceOrder), asTransferDocument(targetOrder));
    if (conflicts.length > 0) throw new PurchaseOrderTransferConflict(conflicts.join(' '));

    const itemOrderIds = createTarget ? [input.sourceOrderId] : orderIds;
    const itemPlaceholders = itemOrderIds.map(() => '?').join(', ');
    const [allItems] = await conn.execute<PurchaseOrderItemRow[]>(
      `SELECT * FROM ims_purchase_order_items
        WHERE business_id = ? AND po_id IN (${itemPlaceholders}) ORDER BY id FOR UPDATE`,
      [input.businessId, ...itemOrderIds],
    );
    const sourceItems = allItems.filter(item => Number(item.po_id) === input.sourceOrderId);
    const targetItems = allItems.filter(item => Number(item.po_id) === targetOrderId);
    const sourceById = new Map(sourceItems.map(item => [Number(item.id), item]));
    const targetByKey = new Map(targetItems.map(item => [lineKey(item), item]));

    const [sourceOperation] = await conn.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'purchase_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, input.sourceOrderId, sourceOrder.status,
        JSON.stringify(sourceOrder), input.actorId ?? null, input.actorName ?? null],
    );
    const [targetOperation] = await conn.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'purchase_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, `${operationKey}:destination`, requestHash, targetOrderId, targetOrder.status,
        JSON.stringify(targetOrder), input.actorId ?? null, input.actorName ?? null],
    );

    const movedLines: PurchaseOrderTransferResult['movedLines'] = [];
    const incomingDeltas = new Map<string, number>();
    for (const command of lines) {
      const sourceItem = sourceById.get(command.sourceItemId);
      if (!sourceItem) throw new PurchaseOrderTransferConflict(`Purchase Order line ${command.sourceItemId} was not found on the source order.`);
      const outstanding = scaled(Number(sourceItem.qty_ordered), 'Ordered quantity') - scaled(Number(sourceItem.qty_received), 'Received quantity');
      const move = scaled(command.quantity, 'Move quantity');
      if (move > outstanding) throw new PurchaseOrderTransferConflict(`${sourceItem.variant_id} has only ${quantity(outstanding)} outstanding.`);

      const [allocationRows] = await conn.execute<any[]>(
        `SELECT * FROM ims_stock_allocations
          WHERE business_id = ? AND po_item_id = ? AND state = 'active'
          ORDER BY priority, created_at, id FOR UPDATE`,
        [input.businessId, sourceItem.id],
      );
      const allocationById = new Map(allocationRows.map(row => [Number(row.id), row]));
      const totalProtected = allocationRows.reduce((sum, row) => sum + Math.max(0,
        scaled(Number(row.qty_allocated), 'Allocated quantity') - scaled(Number(row.qty_received_assigned), 'Received assigned quantity')), 0);
      const selectedProtected = command.allocations.reduce((sum, selection) => sum + scaled(selection.quantity, 'Promise quantity'), 0);
      if (move > outstanding - totalProtected + selectedProtected) {
        throw new PurchaseOrderTransferConflict(`${sourceItem.variant_id} cannot move that much without selecting more customer promises.`);
      }
      if (targetOrder.status === 'draft' && selectedProtected > 0) {
        throw new PurchaseOrderTransferConflict('Customer promises cannot move to a Draft Purchase Order.');
      }
      for (const selection of command.allocations) {
        const allocation = allocationById.get(selection.allocationId);
        if (!allocation || Number(allocation.revision ?? 0) !== selection.revision) {
          throw new PurchaseOrderTransferConflict('A selected customer promise changed after preview. Refresh and review again.');
        }
        const movable = scaled(Number(allocation.qty_allocated), 'Allocated quantity')
          - scaled(Number(allocation.qty_received_assigned), 'Received assigned quantity');
        if (scaled(selection.quantity, 'Promise quantity') > movable) {
          throw new PurchaseOrderTransferConflict('A selected customer promise no longer has enough unreceived quantity.');
        }
      }

      let targetItem = targetByKey.get(lineKey(sourceItem));
      const targetBefore = targetItem ? { ...targetItem } : null;
      if (targetItem) {
        const next = quantity(scaled(Number(targetItem.qty_ordered), 'Target ordered quantity') + move);
        await conn.execute(
          `UPDATE ims_purchase_order_items SET qty_ordered = ?, line_total = ?
            WHERE business_id = ? AND po_id = ? AND id = ?`,
          [next, lineTotal(next, targetItem), input.businessId, targetOrderId, targetItem.id],
        );
        targetItem = { ...targetItem, qty_ordered: next, line_total: lineTotal(next, targetItem) };
        targetByKey.set(lineKey(sourceItem), targetItem);
      } else {
        const [insertResult] = await conn.execute<any>(
          `INSERT INTO ims_purchase_order_items
            (business_id, po_id, variant_id, qty_ordered, qty_received, unit_cost,
             discount_pct, tax_rate, line_total, notes, is_stock_item)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          [input.businessId, targetOrderId, sourceItem.variant_id, command.quantity,
            sourceItem.unit_cost, sourceItem.discount_pct ?? 0, sourceItem.tax_rate ?? 0,
            lineTotal(command.quantity, sourceItem), sourceItem.notes ?? null, Number(sourceItem.is_stock_item ?? 1)],
        );
        targetItem = { ...sourceItem, id: Number(insertResult.insertId), po_id: targetOrderId,
          qty_ordered: command.quantity, qty_received: 0, line_total: lineTotal(command.quantity, sourceItem) };
        targetItems.push(targetItem);
        targetByKey.set(lineKey(sourceItem), targetItem);
      }

      const sourceBefore = { ...sourceItem };
      const nextSourceQuantity = quantity(scaled(Number(sourceItem.qty_ordered), 'Source ordered quantity') - move);
      sourceItem.qty_ordered = nextSourceQuantity;
      sourceItem.line_total = lineTotal(nextSourceQuantity, sourceItem);
      await conn.execute(
        `UPDATE ims_purchase_order_items SET qty_ordered = ?, line_total = ?
          WHERE business_id = ? AND po_id = ? AND id = ?`,
        [nextSourceQuantity, sourceItem.line_total, input.businessId, input.sourceOrderId, sourceItem.id],
      );

      for (const selection of command.allocations) {
        const allocation = allocationById.get(selection.allocationId)!;
        const moveAllocation = quantity(scaled(selection.quantity, 'Promise quantity'));
        const movable = scaled(Number(allocation.qty_allocated), 'Allocated quantity')
          - scaled(Number(allocation.qty_received_assigned), 'Received assigned quantity');
        if (scaled(moveAllocation, 'Promise quantity') === movable
          && Number(allocation.qty_received_assigned ?? 0) === 0 && Number(allocation.qty_fulfilled ?? 0) === 0) {
          await conn.execute(
            `UPDATE ims_stock_allocations
                SET po_id = ?, po_item_id = ?, source_expected_date = ?, promise_status = 'at_risk',
                    risk_reason = 'Protected supply moved to another Purchase Order.', revision = revision + 1
              WHERE business_id = ? AND id = ? AND revision = ?`,
            [targetOrderId, targetItem.id, targetOrder.expected_date ?? null,
              input.businessId, allocation.id, selection.revision],
          );
        } else {
          await conn.execute(
            `UPDATE ims_stock_allocations
                SET qty_allocated = qty_allocated - ?, revision = revision + 1
              WHERE business_id = ? AND id = ? AND revision = ?`,
            [moveAllocation, input.businessId, allocation.id, selection.revision],
          );
          await conn.execute(
            `INSERT INTO ims_stock_allocations
              (business_id, so_id, so_item_id, po_id, po_item_id, variant_id, location_id,
               qty_allocated, qty_received_assigned, qty_fulfilled, source_expected_date, promised_date,
               promise_status, state, priority, override_reason, risk_reason, created_by, created_by_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'at_risk', 'active', ?, ?, ?, ?, ?)`,
            [input.businessId, allocation.so_id, allocation.so_item_id, targetOrderId, targetItem.id,
              allocation.variant_id, allocation.location_id, moveAllocation, targetOrder.expected_date ?? null,
              allocation.promised_date ?? null, allocation.priority, allocation.override_reason ?? null,
              'Protected supply moved to another Purchase Order.', allocation.created_by ?? null,
              allocation.created_by_name ?? null],
          );
        }
      }

      await conn.execute(
        `INSERT INTO ims_po_backorder_lines
          (business_id, operation_key, source_po_id, source_po_item_id,
           backorder_po_id, backorder_po_item_id, transferred_qty, source_item_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, `${operationKey}:${sourceItem.id}`, input.sourceOrderId, sourceItem.id,
          targetOrderId, targetItem.id, command.quantity, JSON.stringify(sourceBefore)],
      );
      await conn.execute(
        `INSERT INTO ims_order_amendment_lines
          (business_id, amendment_id, source_line_id, result_line_id, moved_quantity_floor,
           before_line_json, after_line_json)
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, Number(sourceOperation.insertId), sourceItem.id, sourceItem.id, command.quantity,
          JSON.stringify(sourceBefore), JSON.stringify(sourceItem), input.businessId, Number(targetOperation.insertId),
          targetBefore?.id ?? null, targetItem.id, command.quantity,
          targetBefore == null ? null : JSON.stringify(targetBefore), JSON.stringify(targetItem)],
      );

      if (Number(sourceItem.is_stock_item ?? 1) === 1) {
        const delta = (INCOMING_STATUSES.has(String(targetOrder.status)) ? move : 0)
          - (INCOMING_STATUSES.has(String(sourceOrder.status)) ? move : 0);
        incomingDeltas.set(sourceItem.variant_id, (incomingDeltas.get(sourceItem.variant_id) ?? 0) + delta);
      }
      movedLines.push({ sourceItemId: Number(sourceItem.id), targetItemId: Number(targetItem.id),
        variantId: String(sourceItem.variant_id), quantity: command.quantity,
        protectedQuantity: quantity(selectedProtected) });
    }

    for (const [variantId, deltaScaled] of incomingDeltas) {
      if (deltaScaled === 0) continue;
      const delta = quantity(deltaScaled);
      await conn.execute(
        `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_incoming)
         VALUES (?, ?, ?, GREATEST(0, ?))
         ON DUPLICATE KEY UPDATE qty_incoming = GREATEST(0, qty_incoming + ?)`,
        [input.businessId, variantId, sourceOrder.location_id, delta, delta],
      );
    }

    const sourceOutstanding = sourceItems.reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered) - Number(item.qty_received)), 0);
    const sourceReceived = sourceItems.reduce((sum, item) => sum + Number(item.qty_received), 0);
    const sourceStatus = sourceOutstanding <= 0.00005 ? (sourceReceived > 0 ? 'complete' : 'cancelled') : String(sourceOrder.status);
    const sourceTotals = calculateTotals(sourceItems, sourceOrder);
    const targetTotals = calculateTotals(targetItems, targetOrder);
    await conn.execute(
      `UPDATE ims_purchase_orders SET status = ?, subtotal = ?, tax_amount = ?, total_amount = ?
        WHERE business_id = ? AND id = ?`,
      [sourceStatus, sourceTotals.subtotal, sourceTotals.taxAmount, sourceTotals.totalAmount, input.businessId, input.sourceOrderId],
    );
    await conn.execute(
      `UPDATE ims_purchase_orders SET subtotal = ?, tax_amount = ?, total_amount = ?
        WHERE business_id = ? AND id = ?`,
      [targetTotals.subtotal, targetTotals.taxAmount, targetTotals.totalAmount, input.businessId, targetOrderId],
    );
    const result: PurchaseOrderTransferResult = {
      replayed: false, sourceOrderId: input.sourceOrderId, targetOrderId,
      targetOrderNumber: String(targetOrder.po_number), sourceStatus, targetStatus: String(targetOrder.status),
      movedLines, variantIds: Array.from(new Set(movedLines.map(line => line.variantId))),
    };
    await conn.execute(
      `UPDATE ims_order_amendment_operations SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ ...sourceOrder, status: sourceStatus, transferResult: result }), input.businessId, Number(sourceOperation.insertId)],
    );
    await conn.execute(
      `UPDATE ims_order_amendment_operations SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ ...targetOrder, transferSourceOrderId: input.sourceOrderId,
        transferSourceOrderNumber: sourceOrder.po_number }), input.businessId, Number(targetOperation.insertId)],
    );
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (numberLockAcquired) await conn.execute(`SELECT RELEASE_LOCK(?)`, [numberLockName]);
    conn.release();
  }
}