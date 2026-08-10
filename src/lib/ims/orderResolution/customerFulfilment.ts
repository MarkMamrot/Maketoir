import { createHash } from 'crypto';
import { getIMSPool } from '@/services/IMSMySQLService';

const QUANTITY_SCALE = 10_000;

type ShipmentQuantity = { itemId: number; quantity: number };

export type CustomerFulfilmentResult = {
  soId: number;
  status: 'partially_fulfilled' | 'fulfilled';
  operationKey: string;
  fulfilledVariantIds: string[];
};

function scaledQuantity(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Shipment quantities must be finite numbers.');
  return Math.round(value * QUANTITY_SCALE);
}

export async function fulfilSalesOrderPartial(input: {
  businessId: string;
  soId: number;
  operationKey: string;
  shipmentQuantities: ShipmentQuantity[];
}): Promise<CustomerFulfilmentResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid operation key is required.');

  const requested = new Map<number, number>();
  for (const shipment of input.shipmentQuantities) {
    const itemId = Number(shipment.itemId);
    const quantity = scaledQuantity(Number(shipment.quantity));
    if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('Shipment item IDs must be positive integers.');
    if (quantity < 0) throw new Error('Shipment quantity cannot be negative.');
    if (requested.has(itemId)) throw new Error('Each sales order line may appear only once.');
    requested.set(itemId, quantity);
  }
  if (![...requested.values()].some(quantity => quantity > 0)) {
    throw new Error('At least one positive shipment quantity is required.');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify([...requested.entries()].sort(([left], [right]) => left - right)))
    .digest('hex');

  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT IGNORE INTO ims_so_fulfilment_operations
        (business_id, operation_key, request_hash, so_id, status)
       VALUES (?, ?, ?, ?, 'processing')`,
      [input.businessId, operationKey, requestHash, input.soId],
    );
    const [[operation]] = await conn.execute<any[]>(
      `SELECT so_id, request_hash, status, response_json
         FROM ims_so_fulfilment_operations
        WHERE business_id = ? AND operation_key = ?
        FOR UPDATE`,
      [input.businessId, operationKey],
    );
    if (!operation || Number(operation.so_id) !== input.soId) {
      throw new Error('The operation key is already assigned to a different sales order.');
    }
    if (String(operation.request_hash) !== requestHash) {
      throw new Error('The operation key was already used with different shipment quantities.');
    }
    if (operation.status === 'complete' && operation.response_json) {
      const result = typeof operation.response_json === 'string'
        ? JSON.parse(operation.response_json)
        : operation.response_json;
      await conn.commit();
      return result as CustomerFulfilmentResult;
    }

    const [[so]] = await conn.execute<any[]>(
      `SELECT id, business_id, status, so_type, location_id, is_historical
         FROM ims_sales_orders
        WHERE id = ? AND business_id = ?
        FOR UPDATE`,
      [input.soId, input.businessId],
    );
    if (!so) throw new Error('Sales order not found.');
    if (so.is_historical) throw new Error('Cannot fulfil a historical Cin7 record.');
    if (!['confirmed', 'partially_fulfilled'].includes(String(so.status))) {
      throw new Error('Only confirmed or partially fulfilled sales orders can be shipped.');
    }

    const [items] = await conn.execute<any[]>(
      `SELECT soi.id, soi.variant_id, soi.qty_ordered, soi.qty_fulfilled, soi.unit_cost,
              COALESCE(p.is_stock_item, 1) AS is_stock_item
         FROM ims_sales_order_items soi
         LEFT JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
         LEFT JOIN ims_products p ON p.product_id = pv.product_id
        WHERE soi.so_id = ? AND soi.business_id = ?
        ORDER BY id
        FOR UPDATE`,
      [input.soId, input.businessId],
    );
    const itemsById = new Map(items.map(item => [Number(item.id), item]));
    for (const itemId of requested.keys()) {
      if (!itemsById.has(itemId)) throw new Error(`Sales order item ${itemId} was not found on this order.`);
    }

    const fulfilledVariantIds: string[] = [];
    for (const [itemId, shipmentScaled] of requested) {
      if (shipmentScaled === 0) continue;
      const item = itemsById.get(itemId);
      const orderedScaled = scaledQuantity(Number(item.qty_ordered));
      const fulfilledScaled = scaledQuantity(Number(item.qty_fulfilled ?? 0));
      if (shipmentScaled > orderedScaled - fulfilledScaled) {
        throw new Error(`Shipment quantity exceeds the outstanding quantity for item ${itemId}.`);
      }

      const quantity = shipmentScaled / QUANTITY_SCALE;
      const oldFulfilled = fulfilledScaled / QUANTITY_SCALE;
      const newFulfilled = oldFulfilled + quantity;
      if (Number(item.is_stock_item ?? 1) === 0) {
        await conn.execute(
          `UPDATE ims_sales_order_items SET qty_fulfilled = ?, unit_cost = 0 WHERE id = ? AND so_id = ?`,
          [newFulfilled, itemId, input.soId],
        );
        item.qty_fulfilled = newFulfilled;
        continue;
      }

      const [[stock]] = await conn.execute<any[]>(
        `SELECT s.qty_on_hand, s.qty_committed, COALESCE(pv.avg_cost, 0) AS avg_cost
           FROM ims_stock s
           JOIN ims_product_variants pv ON pv.variant_id = s.variant_id
          WHERE s.variant_id = ? AND s.location_id = ?
          FOR UPDATE`,
        [item.variant_id, so.location_id],
      );
      const oldOnHand = Number(stock?.qty_on_hand ?? 0);
      const oldCommitted = Number(stock?.qty_committed ?? 0);
      if (scaledQuantity(oldOnHand) < shipmentScaled) throw new Error(`Insufficient stock to ship item ${itemId}.`);
      if (scaledQuantity(oldCommitted) < shipmentScaled) throw new Error(`Insufficient committed stock to ship item ${itemId}.`);

      const shipmentCost = Number(stock?.avg_cost ?? 0);
      const oldCost = Number(item.unit_cost ?? 0);
      const weightedCost = newFulfilled > 0
        ? ((oldFulfilled * oldCost) + (quantity * shipmentCost)) / newFulfilled
        : shipmentCost;
      const newOnHand = oldOnHand - quantity;

      await conn.execute(
        `UPDATE ims_stock
            SET qty_on_hand = ?, qty_committed = qty_committed - ?
          WHERE variant_id = ? AND location_id = ?`,
        [newOnHand, quantity, item.variant_id, so.location_id],
      );
      await conn.execute(
        `UPDATE ims_sales_order_items
            SET qty_fulfilled = ?, unit_cost = ?
          WHERE id = ? AND so_id = ?`,
        [newFulfilled, weightedCost, itemId, input.soId],
      );
      await conn.execute(
        `INSERT INTO ims_stock_movements
          (business_id, variant_id, location_id, movement_type, channel, reference_type,
           reference_id, qty_change, qty_after_soh, unit_cost, notes)
         VALUES (?, ?, ?, 'so_fulfilled', ?, 'sales_order', ?, ?, ?, ?, ?)`,
        [
          input.businessId,
          item.variant_id,
          so.location_id,
          so.so_type === 'online' ? 'online' : 'wholesale',
          input.soId,
          -quantity,
          newOnHand,
          shipmentCost,
          `Shipment ${operationKey}`,
        ],
      );
      item.qty_fulfilled = newFulfilled;
      fulfilledVariantIds.push(String(item.variant_id));
    }

    const complete = items.every(item =>
      scaledQuantity(Number(item.qty_fulfilled ?? 0)) >= scaledQuantity(Number(item.qty_ordered)),
    );
    const status = complete ? 'fulfilled' : 'partially_fulfilled';
    await conn.execute(
      `UPDATE ims_sales_orders
          SET status = ?, fulfilled_date = CASE WHEN ? = 'fulfilled' THEN CURDATE() ELSE NULL END
        WHERE id = ? AND business_id = ?`,
      [status, status, input.soId, input.businessId],
    );

    const result: CustomerFulfilmentResult = {
      soId: input.soId,
      status,
      operationKey,
      fulfilledVariantIds: [...new Set(fulfilledVariantIds)],
    };
    await conn.execute(
      `UPDATE ims_so_fulfilment_operations
          SET status = 'complete', response_json = ?, completed_at = NOW()
        WHERE business_id = ? AND operation_key = ?`,
      [JSON.stringify(result), input.businessId, operationKey],
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