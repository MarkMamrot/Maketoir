import { getIMSPool } from '@/services/IMSMySQLService';
import { calculateBackorderSplit, nextBackorderNumber } from './domain';
import { StockShortfallError } from '../orderResolution/stockShortfall';
import { reconcileStockAllocationsForFulfilment, transferStockAllocationsToBackorderLine } from '../stockAllocation/service';

type FulfilQuantity = { itemId: number; quantity: number };

export type CustomerBackorderSplitResult = {
  sourceSoId: number;
  backorderSoId: number;
  backorderSoNumber: string;
  operationKey: string;
  fulfilledVariantIds: string[];
  allocationFulfilments: Array<{
    soItemId: number;
    consumedQuantity: number;
    releasedQuantity: number;
    fulfilledAllocationIds: number[];
    releasedAllocationIds: number[];
  }>;
};

function calculateTotals(items: any[], taxTreatment: string, freight: number, discount: number) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const item of items) {
    const line = Number(item.qty_ordered) * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100);
    const rate = Number(item.tax_rate ?? 0);
    if (taxTreatment === 'inc_tax' && rate > 0) {
      const exTax = line / (1 + rate);
      subtotal += Math.round(exTax * 100) / 100;
      taxAmount += Math.round((line - exTax) * 100) / 100;
    } else {
      subtotal += line;
      if (taxTreatment === 'ex_tax') taxAmount += Math.round(line * rate * 100) / 100;
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

export async function splitCustomerBackorder(input: {
  businessId: string;
  soId: number;
  operationKey: string;
  fulfilQuantities: FulfilQuantity[];
  verifiedDraftXeroId?: string | null;
  allowNegativeStock?: boolean;
}): Promise<CustomerBackorderSplitResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid operation key is required.');

  const requested = new Map<number, number>();
  for (const entry of input.fulfilQuantities) {
    if (!Number.isInteger(entry.itemId) || entry.itemId <= 0 || requested.has(entry.itemId)) {
      throw new Error('Each sales order item must be supplied exactly once.');
    }
    requested.set(entry.itemId, entry.quantity);
  }

  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();

    const [soRows] = await conn.execute<any[]>(
      `SELECT * FROM ims_sales_orders WHERE id = ? AND business_id = ? FOR UPDATE`,
      [input.soId, input.businessId],
    );
    const so = soRows[0];
    if (!so) throw new Error('Sales order not found.');

    const [existingRows] = await conn.execute<any[]>(
      `SELECT backorder_so_id, so.so_number
         FROM ims_so_backorder_lines bl
         JOIN ims_sales_orders so ON so.id = bl.backorder_so_id
        WHERE bl.business_id = ? AND bl.operation_key = ? AND bl.source_so_id = ?
        LIMIT 1 FOR UPDATE`,
      [input.businessId, operationKey, input.soId],
    );
    if (existingRows[0]) {
      await conn.commit();
      return {
        sourceSoId: input.soId,
        backorderSoId: Number(existingRows[0].backorder_so_id),
        backorderSoNumber: String(existingRows[0].so_number),
        operationKey,
        fulfilledVariantIds: [],
        allocationFulfilments: [],
      };
    }

    if (so.status !== 'confirmed') throw new Error('Only confirmed sales orders can be partially fulfilled.');
    if (so.is_historical) throw new Error('Historical sales orders cannot be backordered.');
    if (so.shopify_order_id || String(so.so_type ?? '').toLowerCase() !== 'b2b') {
      throw new Error('Shopify and online sales orders are not supported by customer backorders.');
    }
    if (so.xero_invoice_id && String(so.xero_invoice_id) !== String(input.verifiedDraftXeroId ?? '')) {
      throw new Error('The linked Xero invoice was not verified as Draft.');
    }

    const [paymentRows] = await conn.execute<any[]>(
      `SELECT id FROM ims_sales_order_payments WHERE so_id = ? AND business_id = ? LIMIT 1`,
      [input.soId, input.businessId],
    );
    if (paymentRows[0]) throw new Error('A sales order with payments cannot be split.');

    const [items] = await conn.execute<any[]>(
      `SELECT * FROM ims_sales_order_items WHERE so_id = ? ORDER BY id FOR UPDATE`,
      [input.soId],
    );
    if (!items.length || requested.size !== items.length || items.some((item: any) => !requested.has(Number(item.id)))) {
      throw new Error('A fulfil quantity is required for every sales order item.');
    }

    const splitLines = items.map((item: any) => ({
      item,
      split: calculateBackorderSplit(Number(item.qty_ordered), Number(requested.get(Number(item.id)))),
    }));
    if (!splitLines.some(({ split }) => split.backorderQty > 0)) {
      throw new Error('At least one item must have a backorder quantity.');
    }
    if (!splitLines.some(({ split }) => split.actualQty > 0)) {
      throw new Error('Use cancellation when no items are being fulfilled.');
    }

    const allocationFulfilments: CustomerBackorderSplitResult['allocationFulfilments'] = [];
    for (const { item, split } of splitLines) {
      if (split.actualQty <= 0) continue;
      const allocationResult = await reconcileStockAllocationsForFulfilment(conn, {
        businessId: input.businessId,
        soItemId: Number(item.id),
        fulfilledQuantity: split.actualQty,
        lineFullyFulfilled: false,
        operationKey,
      });
      if (allocationResult.consumedQuantity > 0) {
        allocationFulfilments.push({ soItemId: Number(item.id), ...allocationResult });
      }
    }

    for (const { item, split } of splitLines) {
      if (split.actualQty <= 0 || !item.variant_id) continue;
      const [stockRows] = await conn.execute<any[]>(
        `SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ? FOR UPDATE`,
        [item.variant_id, so.location_id],
      );
      const quantityOnHand = Number(stockRows[0]?.qty_on_hand ?? 0);
      if (quantityOnHand < split.actualQty && !input.allowNegativeStock) {
        throw new StockShortfallError([{
          itemId: Number(item.id),
          variantId: String(item.variant_id),
          requestedQuantity: split.actualQty,
          quantityOnHand,
          resultingQuantityOnHand: quantityOnHand - split.actualQty,
        }]);
      }
    }

    const [numberRows] = await conn.execute<any[]>(
      `SELECT so_number FROM ims_sales_orders WHERE so_number LIKE ?`,
      [`${so.so_number}-B%`],
    );
    const backorderSoNumber = nextBackorderNumber(so.so_number, numberRows.map((row: any) => row.so_number));
    const backorderItems = splitLines.filter(({ split }) => split.backorderQty > 0).map(({ item, split }) => ({
      ...item,
      qty_ordered: split.backorderQty,
      line_total: split.backorderQty * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100),
    }));
    const backorderTotals = calculateTotals(backorderItems, so.tax_treatment, 0, 0);

    const [backorderResult] = await conn.execute<any>(
      `INSERT INTO ims_sales_orders
        (business_id, so_number, so_type, customer_id, customer_po_number, location_id, status, order_date,
         expected_date, notes, payment_terms, price_tier, tax_treatment, tax_code, freight, discount,
         subtotal, tax_amount, total_amount)
       VALUES (?, ?, 'b2b', ?, ?, ?, 'backordered', CURDATE(), ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [
        input.businessId, backorderSoNumber, so.customer_id ?? null, so.customer_po_number ?? null,
        so.location_id, so.expected_date ?? null, `Backorder from ${so.so_number}`,
        so.payment_terms ?? null, so.price_tier ?? 'retail', so.tax_treatment ?? 'ex_tax', so.tax_code ?? null,
        backorderTotals.subtotal, backorderTotals.taxAmount, backorderTotals.totalAmount,
      ],
    );
    const backorderSoId = Number(backorderResult.insertId);

    for (const backorderItem of backorderItems) {
      const [itemResult] = await conn.execute<any>(
        `INSERT INTO ims_sales_order_items
          (so_id, variant_id, qty_ordered, unit_price, discount_pct, tax_rate, line_total, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [backorderSoId, backorderItem.variant_id, backorderItem.qty_ordered, backorderItem.unit_price,
          backorderItem.discount_pct ?? 0, backorderItem.tax_rate ?? 0, backorderItem.line_total, backorderItem.notes ?? null],
      );
      await conn.execute(
        `INSERT INTO ims_so_backorder_lines
          (business_id, operation_key, source_so_id, source_so_item_id, backorder_so_id, backorder_so_item_id, transferred_qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.businessId, operationKey, input.soId, backorderItem.id, backorderSoId, itemResult.insertId, backorderItem.qty_ordered],
      );
      await transferStockAllocationsToBackorderLine(conn, {
        businessId: input.businessId,
        sourceSoItemId: Number(backorderItem.id),
        backorderSoId,
        backorderSoItemId: Number(itemResult.insertId),
        quantity: Number(backorderItem.qty_ordered),
      });
    }

    const actualItems = [];
    for (const { item, split } of splitLines) {
      if (split.actualQty === 0) {
        await conn.execute(`DELETE FROM ims_sales_order_items WHERE id = ?`, [item.id]);
        continue;
      }
      const lineTotal = split.actualQty * Number(item.unit_price) * (1 - Number(item.discount_pct ?? 0) / 100);
      await conn.execute(
        `UPDATE ims_sales_order_items SET qty_ordered = ?, line_total = ? WHERE id = ?`,
        [split.actualQty, lineTotal, item.id],
      );
      actualItems.push({ ...item, qty_ordered: split.actualQty, line_total: lineTotal });
    }
    const actualTotals = calculateTotals(actualItems, so.tax_treatment, Number(so.freight ?? 0), Number(so.discount ?? 0));
    await conn.execute(
      `UPDATE ims_sales_orders SET subtotal = ?, tax_amount = ?, total_amount = ? WHERE id = ?`,
      [actualTotals.subtotal, actualTotals.taxAmount, actualTotals.totalAmount, input.soId],
    );

    for (const item of actualItems) {
      const [stockRows] = await conn.execute<any[]>(
        `SELECT s.qty_on_hand, COALESCE(pv.avg_cost, 0) AS avg_cost,
                COALESCE(p.is_stock_item, 1) AS is_stock_item
           FROM ims_product_variants pv
           JOIN ims_products p ON p.product_id = pv.product_id
           LEFT JOIN ims_stock s ON s.variant_id = pv.variant_id AND s.location_id = ?
          WHERE pv.variant_id = ? FOR UPDATE`,
        [so.location_id, item.variant_id],
      );
      if (Number(stockRows[0]?.is_stock_item ?? 1) === 0) {
        await conn.execute(
          `UPDATE ims_sales_order_items SET qty_fulfilled = qty_ordered, unit_cost = 0 WHERE id = ?`,
          [item.id],
        );
        continue;
      }
      const oldSoh = Number(stockRows[0]?.qty_on_hand ?? 0);
      const avgCost = Number(stockRows[0]?.avg_cost ?? 0);
      const newSoh = oldSoh - Number(item.qty_ordered);
      await conn.execute(
        `UPDATE ims_stock SET qty_on_hand = ?, qty_committed = GREATEST(0, qty_committed - ?)
          WHERE variant_id = ? AND location_id = ?`,
        [newSoh, item.qty_ordered, item.variant_id, so.location_id],
      );
      await conn.execute(
        `UPDATE ims_sales_order_items SET qty_fulfilled = qty_ordered, unit_cost = ? WHERE id = ?`,
        [avgCost, item.id],
      );
      await conn.execute(
        `INSERT INTO ims_stock_movements
          (variant_id, location_id, movement_type, channel, reference_type, reference_id, qty_change, qty_after_soh, unit_cost)
         VALUES (?, ?, 'so_fulfilled', 'wholesale', 'sales_order', ?, ?, ?, ?)`,
        [item.variant_id, so.location_id, input.soId, -Number(item.qty_ordered), newSoh, avgCost],
      );
    }
    await conn.execute(
      `UPDATE ims_sales_orders SET status = 'fulfilled', fulfilled_date = CURDATE() WHERE id = ?`,
      [input.soId],
    );

    await conn.commit();
    return {
      sourceSoId: input.soId,
      backorderSoId,
      backorderSoNumber,
      operationKey,
      fulfilledVariantIds: actualItems.map(item => String(item.variant_id)).filter(Boolean),
      allocationFulfilments,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}