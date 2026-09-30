import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';
import { commercialLineKey } from '../backorders/domain';
import { transferStockAllocationsToBackorderLine } from '../stockAllocation/service';
import {
  getOrderTransferConflicts,
  getOrderTransferDocumentConflicts,
  type OrderTransferDocument,
} from './domain';

const QUANTITY_SCALE = 10_000;
const COMMITTED_STATUSES = new Set(['confirmed', 'partially_fulfilled', 'backordered']);

export class SalesOrderTransferConflict extends Error {
  readonly code = 'sales_order_transfer_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'SalesOrderTransferConflict';
  }
}

export type SalesOrderTransferLineInput = {
  sourceItemId: number;
  quantity: number;
  allocatedIncomingQuantity: number;
};

export type SalesOrderTransferResult = {
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
    allocatedIncomingQuantity: number;
  }>;
  variantIds: string[];
};

type SalesOrderRow = {
  id: number;
  so_number: string;
  business_id: string;
  status: string;
  customer_id: number | null;
  wholesale_company_id?: number | null;
  wholesale_location_id?: number | null;
  wholesale_member_id?: number | null;
  location_id: number;
  currency_code: string;
  exchange_rate: number | string | null;
  tax_treatment: 'ex_tax' | 'inc_tax' | 'no_tax';
  tax_code: string | null;
  payment_terms: string | null;
  price_tier: string | null;
  customer_po_number: string | null;
  order_date?: string | Date | null;
  expected_date?: string | Date | null;
  delivery_address?: string | null;
  delivery_address2?: string | null;
  delivery_suburb?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_postcode?: string | null;
  delivery_country?: string | null;
  channel_shipping_method?: string | null;
  channel_delivery_type?: string | null;
  so_type: string | null;
  is_historical: number | null;
  xero_invoice_id: string | null;
  has_payments: number | string;
  has_submitted_shipment: number | string;
  freight: number | string | null;
  discount: number | string | null;
  updated_at: string | Date | null;
};

type SalesOrderItemRow = {
  id: number;
  business_id: string;
  so_id: number;
  variant_id: string;
  qty_ordered: number | string;
  qty_fulfilled: number | string;
  unit_price: number | string;
  unit_cost: number | string | null;
  discount_pct: number | string | null;
  tax_rate: number | string | null;
  line_total: number | string;
  notes: string | null;
  is_stock_item: number | string | null;
};

function scaled(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new SalesOrderTransferConflict(`${label} must be a finite number.`);
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
    throw new SalesOrderTransferConflict(`${label} changed after this preview. Refresh and review the latest order.`);
  }
}

function asTransferDocument(order: SalesOrderRow): OrderTransferDocument {
  return {
    id: Number(order.id),
    kind: 'sales_order',
    businessId: String(order.business_id),
    contactId: order.customer_id == null ? null : Number(order.customer_id),
    locationId: Number(order.location_id),
    currencyCode: String(order.currency_code ?? 'AUD'),
    exchangeRate: Number(order.exchange_rate ?? 1),
    taxTreatment: String(order.tax_treatment ?? 'ex_tax'),
    taxCode: order.tax_code ?? null,
    paymentTerms: order.payment_terms ?? null,
    priceTier: order.price_tier ?? null,
    externalReference: order.customer_po_number ?? null,
    status: String(order.status),
    hasPayments: Boolean(Number(order.has_payments ?? 0)),
    xeroDocumentId: order.xero_invoice_id ?? null,
    xeroDocumentStatus: order.xero_invoice_id ? 'UNKNOWN' : null,
    hasSubmittedShipment: Boolean(Number(order.has_submitted_shipment ?? 0)),
    commerciallyEditable: !Number(order.is_historical ?? 0) && String(order.so_type ?? 'b2b') !== 'online',
  };
}

function lineKey(item: SalesOrderItemRow): string {
  return commercialLineKey({
    variantId: item.variant_id,
    unitAmount: Number(item.unit_price),
    discountPct: Number(item.discount_pct ?? 0),
    taxRate: Number(item.tax_rate ?? 0),
    notes: item.notes ?? null,
  });
}

function lineTotal(quantityOrdered: number, item: SalesOrderItemRow): number {
  return Math.round(quantityOrdered * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100) * 100) / 100;
}

function calculateTotals(
  items: SalesOrderItemRow[],
  taxTreatment: 'ex_tax' | 'inc_tax' | 'no_tax',
  freight: number,
  discount: number,
) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const item of items) {
    const value = Number(item.qty_ordered) * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100);
    const rate = Number(item.tax_rate ?? 0);
    if (taxTreatment === 'inc_tax' && rate > 0) {
      const exTax = value / (1 + rate);
      subtotal += Math.round(exTax * 100) / 100;
      taxAmount += Math.round((value - exTax) * 100) / 100;
    } else {
      subtotal += value;
      if (taxTreatment === 'ex_tax') taxAmount += Math.round(value * rate * 100) / 100;
    }
  }
  subtotal = Math.round(subtotal * 100) / 100;
  taxAmount = taxTreatment === 'no_tax' ? 0 : Math.round(taxAmount * 100) / 100;
  return {
    subtotal,
    taxAmount,
    totalAmount: Math.round((subtotal + taxAmount + freight - discount) * 100) / 100,
  };
}

function canonicalLines(lines: SalesOrderTransferLineInput[]) {
  return lines
    .map(line => ({
      sourceItemId: Number(line.sourceItemId),
      quantity: quantity(scaled(Number(line.quantity), 'Move quantity')),
      allocatedIncomingQuantity: quantity(scaled(Number(line.allocatedIncomingQuantity), 'Protected incoming quantity')),
    }))
    .sort((left, right) => left.sourceItemId - right.sourceItemId);
}

function newTargetStatus(sourceStatus: string): string {
  if (sourceStatus === 'draft' || sourceStatus === 'backordered') return sourceStatus;
  return 'confirmed';
}

async function createTransferTarget(
  conn: any,
  businessId: string,
  sourceOrder: SalesOrderRow,
): Promise<SalesOrderRow> {
  const lockName = `ims:${businessId}:so:number`;
  const [[lockResult]] = await conn.execute<any[]>(`SELECT GET_LOCK(?, 10) AS acquired`, [lockName]);
  if (Number(lockResult?.acquired) !== 1) {
    throw new SalesOrderTransferConflict('Could not allocate a new Sales Order number. Please retry.');
  }
  try {
    const year = new Date().getFullYear();
    const [[numberRow]] = await conn.execute<any[]>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(so_number, '-', -1) AS UNSIGNED)) AS max_seq
         FROM ims_sales_orders
        WHERE business_id = ? AND so_number LIKE ?`,
      [businessId, `SO-${year}-%`],
    );
    const soNumber = `SO-${year}-${String(Number(numberRow?.max_seq ?? 0) + 1).padStart(4, '0')}`;
    const status = newTargetStatus(String(sourceOrder.status));
    const [insertResult] = await conn.execute<any>(
      `INSERT INTO ims_sales_orders
        (business_id, so_number, so_type, customer_id, wholesale_company_id, wholesale_location_id,
         wholesale_member_id, customer_po_number, location_id, status, order_date, expected_date,
         delivery_address, delivery_address2, delivery_suburb, delivery_city, delivery_state,
         delivery_postcode, delivery_country, channel_shipping_method, channel_delivery_type,
         payment_terms, price_tier, tax_treatment, tax_code, freight, discount,
         subtotal, tax_amount, total_amount, currency_code, exchange_rate, notes)
       VALUES (?, ?, 'b2b', ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
      [businessId, soNumber, sourceOrder.customer_id ?? null,
        sourceOrder.wholesale_company_id ?? null, sourceOrder.wholesale_location_id ?? null,
        sourceOrder.wholesale_member_id ?? null, sourceOrder.customer_po_number ?? null,
        sourceOrder.location_id, status, sourceOrder.expected_date ?? null,
        sourceOrder.delivery_address ?? null, sourceOrder.delivery_address2 ?? null,
        sourceOrder.delivery_suburb ?? null, sourceOrder.delivery_city ?? null,
        sourceOrder.delivery_state ?? null, sourceOrder.delivery_postcode ?? null,
        sourceOrder.delivery_country ?? null, sourceOrder.channel_shipping_method ?? null,
        sourceOrder.channel_delivery_type ?? null, sourceOrder.payment_terms ?? null,
        sourceOrder.price_tier ?? 'retail', sourceOrder.tax_treatment ?? 'ex_tax',
        sourceOrder.tax_code ?? null, sourceOrder.currency_code ?? 'AUD',
        Number(sourceOrder.exchange_rate ?? 1), `Items moved from ${sourceOrder.so_number}`],
    );
    return {
      ...sourceOrder,
      id: Number(insertResult.insertId),
      so_number: soNumber,
      status,
      so_type: 'b2b',
      is_historical: 0,
      xero_invoice_id: null,
      has_payments: 0,
      has_submitted_shipment: 0,
      freight: 0,
      discount: 0,
      updated_at: null,
    };
  } finally {
    await conn.execute(`SELECT RELEASE_LOCK(?)`, [lockName]);
  }
}

export async function transferSalesOrderItems(input: {
  businessId: string;
  sourceOrderId: number;
  targetOrderId?: number | null;
  createTarget?: boolean;
  lines: SalesOrderTransferLineInput[];
  operationKey: string;
  expectedSourceUpdatedAt?: string | null;
  expectedTargetUpdatedAt?: string | null;
  actorId?: number | null;
  actorName?: string | null;
}): Promise<SalesOrderTransferResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 150) {
    throw new SalesOrderTransferConflict('A valid operation key is required.');
  }
  const createTarget = input.createTarget === true;
  if (!Number.isInteger(input.sourceOrderId) || input.sourceOrderId <= 0) {
    throw new SalesOrderTransferConflict('Choose a valid source Sales Order.');
  }
  if (!createTarget && (!Number.isInteger(input.targetOrderId) || Number(input.targetOrderId) <= 0
    || input.sourceOrderId === input.targetOrderId)) {
    throw new SalesOrderTransferConflict('Choose a different valid destination Sales Order.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new SalesOrderTransferConflict('Select at least one quantity to move.');
  }
  const lines = canonicalLines(input.lines);
  if (new Set(lines.map(line => line.sourceItemId)).size !== lines.length) {
    throw new SalesOrderTransferConflict('Each source line may appear only once.');
  }
  for (const line of lines) {
    if (!Number.isInteger(line.sourceItemId) || line.sourceItemId <= 0 || line.quantity <= 0) {
      throw new SalesOrderTransferConflict('Move line IDs and quantities must be positive.');
    }
    if (line.allocatedIncomingQuantity < 0 || line.allocatedIncomingQuantity > line.quantity) {
      throw new SalesOrderTransferConflict('Protected incoming quantity must be between zero and the move quantity.');
    }
  }
  const requestHash = createHash('sha256').update(JSON.stringify({
    sourceOrderId: input.sourceOrderId,
    destination: createTarget ? 'new' : Number(input.targetOrderId),
    lines,
  })).digest('hex');

  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.execute<any[]>(
      `SELECT request_hash, state, after_header_json
         FROM ims_order_amendment_operations
        WHERE business_id = ? AND operation_key = ? FOR UPDATE`,
      [input.businessId, operationKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.request_hash) !== requestHash) {
        throw new SalesOrderTransferConflict('This move key was already used with different quantities.');
      }
      if (String(existing.state) !== 'complete') {
        throw new SalesOrderTransferConflict('This move is already being processed. Refresh before trying again.');
      }
      const after = typeof existing.after_header_json === 'string'
        ? JSON.parse(existing.after_header_json)
        : existing.after_header_json;
      if (!after?.transferResult) throw new SalesOrderTransferConflict('The completed move result could not be read.');
      await conn.commit();
      return { ...after.transferResult, replayed: true } as SalesOrderTransferResult;
    }

    const orderIds = createTarget
      ? [input.sourceOrderId]
      : [input.sourceOrderId, Number(input.targetOrderId)].sort((left, right) => left - right);
    const orderPlaceholders = orderIds.map(() => '?').join(', ');
    const [orderRows] = await conn.execute<SalesOrderRow[]>(
      `SELECT so.*,
              EXISTS(SELECT 1 FROM ims_sales_order_payments payment
                      WHERE payment.business_id = so.business_id AND payment.so_id = so.id) AS has_payments,
              EXISTS(SELECT 1 FROM ims_shipping_shipments shipment
                      WHERE shipment.business_id = so.business_id AND shipment.so_id = so.id
                        AND (shipment.provider_shipment_id IS NOT NULL
                             OR shipment.status NOT IN ('draft','quoting','failed'))) AS has_submitted_shipment
         FROM ims_sales_orders so
        WHERE so.business_id = ? AND so.id IN (${orderPlaceholders})
        ORDER BY so.id FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (orderRows.length !== orderIds.length) throw new SalesOrderTransferConflict('One or more Sales Orders were not found.');
    const sourceOrder = orderRows.find(order => Number(order.id) === input.sourceOrderId)!;
    assertRevision(sourceOrder.updated_at, input.expectedSourceUpdatedAt, 'The source Sales Order');
    const sourceConflicts = getOrderTransferDocumentConflicts(asTransferDocument(sourceOrder), 'Source');
    if (sourceConflicts.length > 0) throw new SalesOrderTransferConflict(sourceConflicts.join(' '));
    const targetOrder = createTarget
      ? await createTransferTarget(conn, input.businessId, sourceOrder)
      : orderRows.find(order => Number(order.id) === Number(input.targetOrderId))!;
    const targetOrderId = Number(targetOrder.id);
    if (!createTarget) assertRevision(targetOrder.updated_at, input.expectedTargetUpdatedAt, 'The destination Sales Order');
    const conflicts = getOrderTransferConflicts(asTransferDocument(sourceOrder), asTransferDocument(targetOrder));
    if (conflicts.length > 0) throw new SalesOrderTransferConflict(conflicts.join(' '));
    if (targetOrder.status === 'draft' && lines.some(line => line.allocatedIncomingQuantity > 0)) {
      throw new SalesOrderTransferConflict('Protected incoming supply cannot move to a Draft Sales Order. Choose zero protected incoming or use a Confirmed destination.');
    }

    const itemOrderIds = createTarget ? [input.sourceOrderId] : orderIds;
    const itemPlaceholders = itemOrderIds.map(() => '?').join(', ');
    const [allItems] = await conn.execute<SalesOrderItemRow[]>(
      `SELECT item.*, COALESCE(variant.is_stock_item, 1) AS is_stock_item
         FROM ims_sales_order_items item
         LEFT JOIN ims_product_variants variant ON variant.variant_id = item.variant_id
        WHERE item.business_id = ? AND item.so_id IN (${itemPlaceholders})
        ORDER BY item.id FOR UPDATE`,
      [input.businessId, ...itemOrderIds],
    );
    const sourceItems = allItems.filter(item => Number(item.so_id) === input.sourceOrderId);
    const targetItems = allItems.filter(item => Number(item.so_id) === targetOrderId);
    const sourceById = new Map(sourceItems.map(item => [Number(item.id), item]));
    const targetByKey = new Map(targetItems.map(item => [lineKey(item), item]));

    const [sourceOperationResult] = await conn.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'sales_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, operationKey, requestHash, input.sourceOrderId, sourceOrder.status,
        JSON.stringify(sourceOrder), input.actorId ?? null, input.actorName ?? null],
    );
    const destinationOperationKey = `${operationKey}:destination`;
    const [targetOperationResult] = await conn.execute<any>(
      `INSERT INTO ims_order_amendment_operations
        (business_id, operation_key, request_hash, order_kind, order_id, order_status, state,
         before_header_json, actor_id, actor_name)
       VALUES (?, ?, ?, 'sales_order', ?, ?, 'processing', ?, ?, ?)`,
      [input.businessId, destinationOperationKey, requestHash, targetOrderId, targetOrder.status,
        JSON.stringify(targetOrder), input.actorId ?? null, input.actorName ?? null],
    );

    const movedLines: SalesOrderTransferResult['movedLines'] = [];
    const commitmentDeltas = new Map<string, number>();
    for (const command of lines) {
      const sourceItem = sourceById.get(command.sourceItemId);
      if (!sourceItem) throw new SalesOrderTransferConflict(`Sales Order line ${command.sourceItemId} was not found on the source order.`);
      const outstandingScaled = scaled(Number(sourceItem.qty_ordered), 'Ordered quantity')
        - scaled(Number(sourceItem.qty_fulfilled), 'Fulfilled quantity');
      const moveScaled = scaled(command.quantity, 'Move quantity');
      if (moveScaled > outstandingScaled) {
        throw new SalesOrderTransferConflict(`${sourceItem.variant_id} has only ${quantity(outstandingScaled)} outstanding.`);
      }

      const [allocationRows] = await conn.execute<any[]>(
        `SELECT COALESCE(SUM(GREATEST(0, qty_allocated - qty_fulfilled)), 0) AS available
           FROM ims_stock_allocations
          WHERE business_id = ? AND so_item_id = ? AND state = 'active' FOR UPDATE`,
        [input.businessId, sourceItem.id],
      );
      const availableAllocated = scaled(Number(allocationRows[0]?.available ?? 0), 'Available protected incoming quantity');
      const requestedAllocated = scaled(command.allocatedIncomingQuantity, 'Protected incoming quantity');
      if (requestedAllocated > availableAllocated) {
        throw new SalesOrderTransferConflict(`${sourceItem.variant_id} no longer has enough protected incoming quantity.`);
      }

      let targetItem = targetByKey.get(lineKey(sourceItem));
      const targetBefore = targetItem ? { ...targetItem } : null;
      if (targetItem) {
        const newTargetQuantity = quantity(scaled(Number(targetItem.qty_ordered), 'Destination ordered quantity') + moveScaled);
        const newTargetLineTotal = lineTotal(newTargetQuantity, targetItem);
        await conn.execute(
          `UPDATE ims_sales_order_items SET qty_ordered = ?, line_total = ?
            WHERE business_id = ? AND so_id = ? AND id = ?`,
            [newTargetQuantity, newTargetLineTotal, input.businessId, targetOrderId, targetItem.id],
        );
        targetItem = { ...targetItem, qty_ordered: newTargetQuantity, line_total: newTargetLineTotal };
        Object.assign(targetByKey.get(lineKey(sourceItem))!, targetItem);
      } else {
        const [insertResult] = await conn.execute<any>(
          `INSERT INTO ims_sales_order_items
            (business_id, so_id, variant_id, qty_ordered, qty_fulfilled, unit_price, unit_cost,
             discount_pct, tax_rate, line_total, notes)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          [input.businessId, targetOrderId, sourceItem.variant_id, command.quantity,
            sourceItem.unit_price, sourceItem.unit_cost ?? null, sourceItem.discount_pct ?? 0,
            sourceItem.tax_rate ?? 0, lineTotal(command.quantity, sourceItem), sourceItem.notes ?? null],
        );
        targetItem = {
          ...sourceItem,
          id: Number(insertResult.insertId),
          so_id: targetOrderId,
          qty_ordered: command.quantity,
          qty_fulfilled: 0,
          line_total: lineTotal(command.quantity, sourceItem),
        };
        targetItems.push(targetItem);
        targetByKey.set(lineKey(sourceItem), targetItem);
      }

      const sourceBefore = { ...sourceItem };
      const newSourceQuantity = quantity(scaled(Number(sourceItem.qty_ordered), 'Source ordered quantity') - moveScaled);
      const newSourceLineTotal = lineTotal(newSourceQuantity, sourceItem);
      await conn.execute(
        `UPDATE ims_sales_order_items SET qty_ordered = ?, line_total = ?
          WHERE business_id = ? AND so_id = ? AND id = ?`,
        [newSourceQuantity, newSourceLineTotal, input.businessId, input.sourceOrderId, sourceItem.id],
      );
      sourceItem.qty_ordered = newSourceQuantity;
      sourceItem.line_total = newSourceLineTotal;

      if (requestedAllocated > 0) {
        const transferred = await transferStockAllocationsToBackorderLine(conn, {
          businessId: input.businessId,
          sourceSoItemId: Number(sourceItem.id),
          backorderSoId: targetOrderId,
          backorderSoItemId: Number(targetItem.id),
          quantity: quantity(requestedAllocated),
        });
        if (scaled(transferred, 'Transferred protected incoming quantity') !== requestedAllocated) {
          throw new SalesOrderTransferConflict('Protected incoming supply changed while the move was being applied.');
        }
      }

      await conn.execute(
        `INSERT INTO ims_so_backorder_lines
          (business_id, operation_key, source_so_id, source_so_item_id,
           backorder_so_id, backorder_so_item_id, transferred_qty, source_item_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, `${operationKey}:${sourceItem.id}`, input.sourceOrderId, sourceItem.id,
          targetOrderId, targetItem.id, command.quantity, JSON.stringify(sourceBefore)],
      );
      await conn.execute(
        `INSERT INTO ims_order_amendment_lines
          (business_id, amendment_id, source_line_id, result_line_id, moved_quantity_floor,
           before_line_json, after_line_json)
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, Number(sourceOperationResult.insertId), sourceItem.id, sourceItem.id, command.quantity,
          JSON.stringify(sourceBefore), JSON.stringify(sourceItem),
          input.businessId, Number(targetOperationResult.insertId), targetBefore?.id ?? null, targetItem.id, command.quantity,
          targetBefore == null ? null : JSON.stringify(targetBefore), JSON.stringify(targetItem)],
      );

      if (Number(sourceItem.is_stock_item ?? 1) === 1) {
        const sourceOwnsCommitment = COMMITTED_STATUSES.has(String(sourceOrder.status));
        const targetOwnsCommitment = COMMITTED_STATUSES.has(String(targetOrder.status));
        const delta = (targetOwnsCommitment ? moveScaled : 0) - (sourceOwnsCommitment ? moveScaled : 0);
        commitmentDeltas.set(sourceItem.variant_id, (commitmentDeltas.get(sourceItem.variant_id) ?? 0) + delta);
      }
      movedLines.push({
        sourceItemId: Number(sourceItem.id),
        targetItemId: Number(targetItem.id),
        variantId: String(sourceItem.variant_id),
        quantity: command.quantity,
        allocatedIncomingQuantity: command.allocatedIncomingQuantity,
      });
    }

    for (const [variantId, deltaScaled] of commitmentDeltas) {
      if (deltaScaled === 0) continue;
      const delta = quantity(deltaScaled);
      await conn.execute(
        `INSERT INTO ims_stock (business_id, variant_id, location_id, qty_committed)
         VALUES (?, ?, ?, GREATEST(0, ?))
         ON DUPLICATE KEY UPDATE qty_committed = GREATEST(0, qty_committed + ?)`,
        [input.businessId, variantId, sourceOrder.location_id, delta, delta],
      );
    }

    const sourceOutstanding = sourceItems.reduce((sum, item) => sum + Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)), 0);
    const sourceFulfilled = sourceItems.reduce((sum, item) => sum + Math.max(0, Number(item.qty_fulfilled)), 0);
    const sourceStatus = sourceOutstanding <= 0.00005
      ? sourceFulfilled > 0 ? 'fulfilled' : 'cancelled'
      : String(sourceOrder.status);
    const sourceTotals = calculateTotals(sourceItems, sourceOrder.tax_treatment, Number(sourceOrder.freight ?? 0), Number(sourceOrder.discount ?? 0));
    const targetTotals = calculateTotals(targetItems, targetOrder.tax_treatment, Number(targetOrder.freight ?? 0), Number(targetOrder.discount ?? 0));
    await conn.execute(
      `UPDATE ims_sales_orders
          SET status = ?, subtotal = ?, tax_amount = ?, total_amount = ?
        WHERE business_id = ? AND id = ?`,
      [sourceStatus, sourceTotals.subtotal, sourceTotals.taxAmount, sourceTotals.totalAmount,
        input.businessId, input.sourceOrderId],
    );
    await conn.execute(
      `UPDATE ims_sales_orders
          SET subtotal = ?, tax_amount = ?, total_amount = ?
        WHERE business_id = ? AND id = ?`,
      [targetTotals.subtotal, targetTotals.taxAmount, targetTotals.totalAmount,
        input.businessId, targetOrderId],
    );

    const result: SalesOrderTransferResult = {
      replayed: false,
      sourceOrderId: input.sourceOrderId,
      targetOrderId,
      targetOrderNumber: String(targetOrder.so_number),
      sourceStatus,
      targetStatus: String(targetOrder.status),
      movedLines,
      variantIds: Array.from(new Set(movedLines.map(line => line.variantId))),
    };
    await conn.execute(
      `UPDATE ims_order_amendment_operations
          SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ ...sourceOrder, status: sourceStatus, transferResult: result }),
        input.businessId, Number(sourceOperationResult.insertId)],
    );
    await conn.execute(
      `UPDATE ims_order_amendment_operations
          SET state = 'complete', after_header_json = ?, completed_at = NOW()
        WHERE business_id = ? AND id = ?`,
      [JSON.stringify({ ...targetOrder, transferSourceOrderId: input.sourceOrderId,
        transferSourceOrderNumber: sourceOrder.so_number }),
        input.businessId, Number(targetOperationResult.insertId)],
    );
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}