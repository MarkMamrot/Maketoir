import { getIMSPool } from '@/services/IMSMySQLService';
import { commercialLineKey, getBackorderMergeConflict, type BackorderMergeDocument } from './domain';

export type BackorderMergeType = 'customer' | 'supplier';

export type BackorderMergeResult = {
  type: BackorderMergeType;
  targetOrderId: number;
  targetOrderNumber: string;
  sourceOrderIds: number[];
  operationKey: string;
  variantIds: string[];
};

type MergeConfig = {
  orderTable: string;
  itemTable: string;
  itemOrderColumn: string;
  orderNumberColumn: string;
  contactColumn: string;
  externalReferenceColumn: string | null;
  amountColumn: 'unit_price' | 'unit_cost';
  provenanceTable: string;
  provenanceOrderColumn: string;
  provenanceItemColumn: string;
};

const CONFIGS: Record<BackorderMergeType, MergeConfig> = {
  customer: {
    orderTable: 'ims_sales_orders',
    itemTable: 'ims_sales_order_items',
    itemOrderColumn: 'so_id',
    orderNumberColumn: 'so_number',
    contactColumn: 'customer_id',
    externalReferenceColumn: 'customer_po_number',
    amountColumn: 'unit_price',
    provenanceTable: 'ims_so_backorder_lines',
    provenanceOrderColumn: 'backorder_so_id',
    provenanceItemColumn: 'backorder_so_item_id',
  },
  supplier: {
    orderTable: 'ims_purchase_orders',
    itemTable: 'ims_purchase_order_items',
    itemOrderColumn: 'po_id',
    orderNumberColumn: 'po_number',
    contactColumn: 'supplier_id',
    externalReferenceColumn: 'supplier_invoice_number',
    amountColumn: 'unit_cost',
    provenanceTable: 'ims_po_backorder_lines',
    provenanceOrderColumn: 'backorder_po_id',
    provenanceItemColumn: 'backorder_po_item_id',
  },
};

function asMergeDocument(order: any, config: MergeConfig, businessId: string): BackorderMergeDocument {
  return {
    businessId,
    contactId: order[config.contactColumn] == null ? null : Number(order[config.contactColumn]),
    locationId: Number(order.location_id),
    currencyCode: String(order.currency_code ?? 'AUD'),
    exchangeRate: Number(order.exchange_rate ?? 1),
    taxTreatment: String(order.tax_treatment ?? 'ex_tax'),
    taxCode: order.tax_code ?? null,
    paymentTerms: order.payment_terms ?? null,
    priceTier: config.amountColumn === 'unit_price' ? order.price_tier ?? null : null,
    externalReference: config.externalReferenceColumn ? order[config.externalReferenceColumn] ?? null : null,
  };
}

function calculateTotals(items: any[], config: MergeConfig, taxTreatment: string, freight: number, discount: number) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const item of items) {
    const line = Number(item.qty_ordered) * Number(item[config.amountColumn])
      * (1 - Number(item.discount_pct ?? 0) / 100);
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

async function mergeBackorders(input: {
  businessId: string;
  type: BackorderMergeType;
  orderIds: number[];
  operationKey: string;
}): Promise<BackorderMergeResult> {
  const operationKey = input.operationKey.trim();
  if (!operationKey || operationKey.length > 191) throw new Error('A valid operation key is required.');
  const orderIds = Array.from(new Set(input.orderIds));
  if (orderIds.length < 2 || orderIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error('Select at least two valid backorders to merge.');
  }

  const config = CONFIGS[input.type];
  const conn = await getIMSPool().getConnection();
  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.execute<any[]>(
      `SELECT target_order_id, source_order_ids
         FROM ims_backorder_merges
        WHERE business_id = ? AND operation_key = ? AND backorder_type = ?
        LIMIT 1 FOR UPDATE`,
      [input.businessId, operationKey, input.type],
    );
    if (existingRows[0]) {
      const targetOrderId = Number(existingRows[0].target_order_id);
      const [targetRows] = await conn.execute<any[]>(
        `SELECT ${config.orderNumberColumn} AS order_number FROM ${config.orderTable}
          WHERE id = ? AND business_id = ?`,
        [targetOrderId, input.businessId],
      );
      await conn.commit();
      return {
        type: input.type,
        targetOrderId,
        targetOrderNumber: String(targetRows[0]?.order_number ?? ''),
        sourceOrderIds: Array.isArray(existingRows[0].source_order_ids)
          ? existingRows[0].source_order_ids.map(Number)
          : JSON.parse(String(existingRows[0].source_order_ids ?? '[]')),
        operationKey,
        variantIds: [],
      };
    }

    const placeholders = orderIds.map(() => '?').join(',');
    const [orders] = await conn.execute<any[]>(
      `SELECT * FROM ${config.orderTable}
        WHERE business_id = ? AND id IN (${placeholders})
        ORDER BY created_at, id FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (orders.length !== orderIds.length) throw new Error('One or more backorders were not found.');
    if (orders.some(order => order.status !== 'backordered')) {
      throw new Error('Only held backorders can be merged.');
    }
    if (orders.some(order => order.xero_invoice_id || order.xero_bill_id)) {
      throw new Error('Backorders linked to Xero cannot be merged.');
    }
    const settlementTable = input.type === 'customer' ? 'ims_customer_credit_settlements' : 'ims_supplier_credit_settlements';
    const targetColumn = input.type === 'customer' ? 'target_so_id' : 'target_po_id';
    const [reserved] = await conn.execute<any[]>(
      `SELECT id FROM ${settlementTable} WHERE business_id=? AND ${targetColumn} IN (${placeholders}) AND action_type='reserve_for_order' AND status IN ('planned','running','succeeded') LIMIT 1 FOR UPDATE`,
      [input.businessId, ...orderIds],
    );
    if (reserved.length) throw new Error('Backorders with reserved or allocated Xero credit cannot be merged.');

    const targetOrder = orders[0];
    const sourceOrders = orders.slice(1);
    const targetDocument = asMergeDocument(targetOrder, config, input.businessId);
    if (targetDocument.contactId == null) {
      throw new Error(`Backorders without a ${input.type === 'customer' ? 'customer' : 'supplier'} cannot be merged.`);
    }
    for (const candidate of sourceOrders) {
      const conflict = getBackorderMergeConflict(targetDocument, asMergeDocument(candidate, config, input.businessId));
      if (conflict) throw new Error(`Backorders cannot be merged: ${conflict}`);
    }

    const [items] = await conn.execute<any[]>(
      `SELECT * FROM ${config.itemTable}
        WHERE ${config.itemOrderColumn} IN (${placeholders})
        ORDER BY ${config.itemOrderColumn}, id FOR UPDATE`,
      orderIds,
    );
    if (!items.length) throw new Error('The selected backorders have no line items.');

    const targetItems = items.filter(item => Number(item[config.itemOrderColumn]) === Number(targetOrder.id));
    const targetByKey = new Map<string, any>();
    for (const item of targetItems) {
      targetByKey.set(commercialLineKey({
        variantId: item.variant_id ?? null,
        unitAmount: Number(item[config.amountColumn]),
        discountPct: Number(item.discount_pct ?? 0),
        taxRate: Number(item.tax_rate ?? 0),
        notes: item.notes ?? null,
      }), item);
    }

    for (const sourceItem of items.filter(item => Number(item[config.itemOrderColumn]) !== Number(targetOrder.id))) {
      const key = commercialLineKey({
        variantId: sourceItem.variant_id ?? null,
        unitAmount: Number(sourceItem[config.amountColumn]),
        discountPct: Number(sourceItem.discount_pct ?? 0),
        taxRate: Number(sourceItem.tax_rate ?? 0),
        notes: sourceItem.notes ?? null,
      });
      let targetItem = targetByKey.get(key);
      if (targetItem) {
        targetItem.qty_ordered = Number(targetItem.qty_ordered) + Number(sourceItem.qty_ordered);
        const lineTotal = Number(targetItem.qty_ordered) * Number(targetItem[config.amountColumn])
          * (1 - Number(targetItem.discount_pct ?? 0) / 100);
        await conn.execute(
          `UPDATE ${config.itemTable} SET qty_ordered = ?, line_total = ? WHERE id = ?`,
          [targetItem.qty_ordered, lineTotal, targetItem.id],
        );
      } else {
        const quantityReceivedColumn = input.type === 'supplier' ? ', qty_received' : '';
        const quantityReceivedValue = input.type === 'supplier' ? ', 0' : '';
        const discountColumn = input.type === 'supplier' ? ', discount_pct' : ', discount_pct';
        const [insertResult] = await conn.execute<any>(
          `INSERT INTO ${config.itemTable}
            (business_id, ${config.itemOrderColumn}, variant_id, qty_ordered${quantityReceivedColumn},
             ${config.amountColumn}${discountColumn}, tax_rate, line_total, notes)
           VALUES (?, ?, ?, ?${quantityReceivedValue}, ?, ?, ?, ?, ?)`,
          [input.businessId, targetOrder.id, sourceItem.variant_id, sourceItem.qty_ordered,
            sourceItem[config.amountColumn], sourceItem.discount_pct ?? 0, sourceItem.tax_rate ?? 0,
            sourceItem.line_total, sourceItem.notes ?? null],
        );
        targetItem = { ...sourceItem, id: Number(insertResult.insertId), [config.itemOrderColumn]: targetOrder.id };
        targetItems.push(targetItem);
        targetByKey.set(key, targetItem);
      }

      await conn.execute(
        `UPDATE ${config.provenanceTable}
            SET ${config.provenanceOrderColumn} = ?, ${config.provenanceItemColumn} = ?
          WHERE business_id = ? AND ${config.provenanceOrderColumn} = ? AND ${config.provenanceItemColumn} = ?`,
        [targetOrder.id, targetItem.id, input.businessId, sourceItem[config.itemOrderColumn], sourceItem.id],
      );
    }

    const freight = orders.reduce((sum, order) => sum + Number(order.freight ?? 0), 0);
    const discount = orders.reduce((sum, order) => sum + Number(order.discount ?? 0), 0);
    const totals = calculateTotals(targetItems, config, targetDocument.taxTreatment, freight, discount);
    await conn.execute(
      `UPDATE ${config.orderTable}
          SET freight = ?, discount = ?, subtotal = ?, tax_amount = ?, total_amount = ?
        WHERE id = ? AND business_id = ?`,
      [freight, discount, totals.subtotal, totals.taxAmount, totals.totalAmount, targetOrder.id, input.businessId],
    );

    const sourceOrderIds = sourceOrders.map(order => Number(order.id));
    const sourcePlaceholders = sourceOrderIds.map(() => '?').join(',');
    await conn.execute(
      `UPDATE ${config.orderTable} SET status = 'cancelled'
        WHERE business_id = ? AND id IN (${sourcePlaceholders})`,
      [input.businessId, ...sourceOrderIds],
    );
    await conn.execute(
      `INSERT INTO ims_backorder_merges
        (business_id, operation_key, backorder_type, target_order_id, source_order_ids)
       VALUES (?, ?, ?, ?, ?)`,
      [input.businessId, operationKey, input.type, targetOrder.id, JSON.stringify(sourceOrderIds)],
    );

    await conn.commit();
    return {
      type: input.type,
      targetOrderId: Number(targetOrder.id),
      targetOrderNumber: String(targetOrder[config.orderNumberColumn]),
      sourceOrderIds,
      operationKey,
      variantIds: Array.from(new Set(items.map(item => String(item.variant_id ?? '')).filter(Boolean))),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export function mergeCustomerBackorders(input: Omit<Parameters<typeof mergeBackorders>[0], 'type'>) {
  return mergeBackorders({ ...input, type: 'customer' });
}

export function mergeSupplierBackorders(input: Omit<Parameters<typeof mergeBackorders>[0], 'type'>) {
  return mergeBackorders({ ...input, type: 'supplier' });
}