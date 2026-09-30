import { getIMSPool } from '@/services/IMSMySQLService';
import {
  getOrderTransferConflicts,
  getOrderTransferDocumentConflicts,
  type OrderTransferDocument,
} from './domain';

export class PurchaseOrderTransferPreviewConflict extends Error {
  readonly code = 'purchase_order_transfer_preview_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'PurchaseOrderTransferPreviewConflict';
  }
}

type PurchaseOrderPreviewRow = {
  id: number;
  po_number: string;
  business_id: string;
  supplier_id: number | null;
  supplier_name: string | null;
  location_id: number;
  location_name: string | null;
  order_date: string | null;
  status: string;
  currency_code: string;
  exchange_rate: number | string | null;
  tax_treatment: string;
  tax_code: string | null;
  payment_terms: string | null;
  supplier_invoice_number: string | null;
  is_historical: number | null;
  cin7_order_id: string | null;
  xero_bill_id: string | null;
  has_payments: number | string;
  outstanding_quantity: number | string;
  updated_at: string | null;
};

export type PurchaseOrderTransferAllocation = {
  allocationId: number;
  revision: number;
  salesOrderId: number;
  salesOrderItemId: number;
  salesOrderNumber: string;
  customerName: string | null;
  promisedDate: string | null;
  priority: number;
  promiseStatus: string;
  movableQuantity: number;
};

export type PurchaseOrderTransferPreviewLine = {
  itemId: number;
  variantId: string;
  sku: string | null;
  productName: string;
  isStockItem: boolean;
  orderedQuantity: number;
  receivedQuantity: number;
  outstandingQuantity: number;
  protectedQuantity: number;
  freeQuantity: number;
  allocations: PurchaseOrderTransferAllocation[];
};

export type PurchaseOrderTransferTarget = {
  id: number;
  orderNumber: string;
  updatedAt: string | null;
  supplierName: string | null;
  locationName: string | null;
  orderDate: string | null;
  status: string;
  outstandingQuantity: number;
  conflicts: string[];
};

export type PurchaseOrderTransferPreview = {
  source: {
    id: number;
    orderNumber: string;
    status: string;
    updatedAt: string | null;
    conflicts: string[];
  };
  lines: PurchaseOrderTransferPreviewLine[];
  eligibleTargets: PurchaseOrderTransferTarget[];
  excludedTargets: PurchaseOrderTransferTarget[];
};

function asTransferDocument(row: PurchaseOrderPreviewRow): OrderTransferDocument {
  return {
    id: Number(row.id),
    kind: 'purchase_order',
    businessId: String(row.business_id),
    contactId: row.supplier_id == null ? null : Number(row.supplier_id),
    locationId: Number(row.location_id),
    currencyCode: String(row.currency_code ?? 'AUD'),
    exchangeRate: Number(row.exchange_rate ?? 1),
    taxTreatment: String(row.tax_treatment ?? 'ex_tax'),
    taxCode: row.tax_code ?? null,
    paymentTerms: row.payment_terms ?? null,
    externalReference: row.supplier_invoice_number ?? null,
    status: String(row.status),
    hasPayments: Boolean(Number(row.has_payments ?? 0)),
    xeroDocumentId: row.xero_bill_id ?? null,
    xeroDocumentStatus: row.xero_bill_id ? 'UNKNOWN' : null,
    commerciallyEditable: !Number(row.is_historical ?? 0) && !row.cin7_order_id,
  };
}

function asTarget(row: PurchaseOrderPreviewRow, conflicts: string[]): PurchaseOrderTransferTarget {
  return {
    id: Number(row.id),
    orderNumber: String(row.po_number),
    updatedAt: row.updated_at ?? null,
    supplierName: row.supplier_name ?? null,
    locationName: row.location_name ?? null,
    orderDate: row.order_date ?? null,
    status: String(row.status),
    outstandingQuantity: Number(row.outstanding_quantity ?? 0),
    conflicts,
  };
}

const ORDER_SELECT = `
  SELECT po.id, po.po_number, po.business_id, po.supplier_id, supplier.name AS supplier_name,
         po.location_id, location.name AS location_name, po.order_date, po.status,
         po.currency_code, po.exchange_rate, po.tax_treatment, po.tax_code, po.payment_terms,
         po.supplier_invoice_number, po.is_historical, po.cin7_order_id, po.xero_bill_id, po.updated_at,
         EXISTS(SELECT 1 FROM ims_purchase_order_payments payment
                 WHERE payment.business_id = po.business_id AND payment.po_id = po.id) AS has_payments,
         COALESCE((SELECT SUM(GREATEST(0, item.qty_ordered - item.qty_received))
                     FROM ims_purchase_order_items item
                    WHERE item.business_id = po.business_id AND item.po_id = po.id), 0) AS outstanding_quantity
    FROM ims_purchase_orders po
    LEFT JOIN ims_contacts supplier ON supplier.id = po.supplier_id AND supplier.business_id = po.business_id
    LEFT JOIN ims_locations location ON location.id = po.location_id AND location.business_id = po.business_id`;

export async function previewPurchaseOrderTransfer(input: {
  businessId: string;
  sourceOrderId: number;
}): Promise<PurchaseOrderTransferPreview> {
  const pool = getIMSPool();
  const [sourceRows] = await pool.execute<PurchaseOrderPreviewRow[]>(
    `${ORDER_SELECT} WHERE po.business_id = ? AND po.id = ? LIMIT 1`,
    [input.businessId, input.sourceOrderId],
  );
  const sourceRow = sourceRows[0];
  if (!sourceRow) throw new PurchaseOrderTransferPreviewConflict('Purchase Order was not found.');

  const sourceDocument = asTransferDocument(sourceRow);
  const sourceConflicts = getOrderTransferDocumentConflicts(sourceDocument, 'Source');
  const [lineRows] = await pool.execute<any[]>(
    `SELECT item.id, item.variant_id, item.qty_ordered, item.qty_received, item.is_stock_item,
            variant.sku, product.name AS product_name
       FROM ims_purchase_order_items item
       LEFT JOIN ims_product_variants variant ON variant.variant_id = item.variant_id
       LEFT JOIN ims_products product ON product.product_id = variant.product_id
                                      AND product.business_id = item.business_id
      WHERE item.business_id = ? AND item.po_id = ?
        AND item.qty_ordered > item.qty_received
      ORDER BY item.id`,
    [input.businessId, input.sourceOrderId],
  );
  const itemIds = lineRows.map(row => Number(row.id));
  let allocationRows: any[] = [];
  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(', ');
    const [rows] = await pool.execute<any[]>(
      `SELECT allocation.id, allocation.revision, allocation.po_item_id,
              allocation.so_id, allocation.so_item_id, allocation.qty_allocated,
              allocation.qty_received_assigned, allocation.promised_date,
              allocation.priority, allocation.promise_status,
              sales_order.so_number, customer.name AS customer_name
         FROM ims_stock_allocations allocation
         JOIN ims_sales_orders sales_order
           ON sales_order.id = allocation.so_id AND sales_order.business_id = allocation.business_id
         LEFT JOIN ims_contacts customer
           ON customer.id = sales_order.customer_id AND customer.business_id = sales_order.business_id
        WHERE allocation.business_id = ? AND allocation.po_id = ?
          AND allocation.po_item_id IN (${placeholders}) AND allocation.state = 'active'
          AND allocation.qty_allocated > allocation.qty_received_assigned
        ORDER BY allocation.priority, allocation.created_at, allocation.id`,
      [input.businessId, input.sourceOrderId, ...itemIds],
    );
    allocationRows = rows;
  }

  const lines = lineRows.map(row => {
    const outstandingQuantity = Math.max(0, Number(row.qty_ordered) - Number(row.qty_received ?? 0));
    const allocations = allocationRows
      .filter(allocation => Number(allocation.po_item_id) === Number(row.id))
      .map(allocation => ({
        allocationId: Number(allocation.id),
        revision: Number(allocation.revision ?? 0),
        salesOrderId: Number(allocation.so_id),
        salesOrderItemId: Number(allocation.so_item_id),
        salesOrderNumber: String(allocation.so_number),
        customerName: allocation.customer_name ?? null,
        promisedDate: allocation.promised_date ?? null,
        priority: Number(allocation.priority ?? 0),
        promiseStatus: String(allocation.promise_status ?? 'planned'),
        movableQuantity: Math.max(0, Number(allocation.qty_allocated) - Number(allocation.qty_received_assigned ?? 0)),
      }));
    const protectedQuantity = allocations.reduce((sum, allocation) => sum + allocation.movableQuantity, 0);
    return {
      itemId: Number(row.id),
      variantId: String(row.variant_id),
      sku: row.sku ?? null,
      productName: row.product_name ?? 'Product',
      isStockItem: Boolean(Number(row.is_stock_item ?? 1)),
      orderedQuantity: Number(row.qty_ordered),
      receivedQuantity: Number(row.qty_received ?? 0),
      outstandingQuantity,
      protectedQuantity,
      freeQuantity: Math.max(0, outstandingQuantity - protectedQuantity),
      allocations,
    } satisfies PurchaseOrderTransferPreviewLine;
  });

  const [candidateRows] = await pool.execute<PurchaseOrderPreviewRow[]>(
    `${ORDER_SELECT}
      WHERE po.business_id = ? AND po.id <> ?
        AND po.status IN ('draft','confirmed','partially_received','backordered')
      ORDER BY (po.supplier_id = ?) DESC, po.order_date DESC, po.id DESC
      LIMIT 100`,
    [input.businessId, input.sourceOrderId, sourceRow.supplier_id],
  );
  const eligibleTargets: PurchaseOrderTransferTarget[] = [];
  const excludedTargets: PurchaseOrderTransferTarget[] = [];
  for (const row of candidateRows) {
    const conflicts = getOrderTransferConflicts(sourceDocument, asTransferDocument(row));
    const target = asTarget(row, conflicts);
    if (conflicts.length === 0) eligibleTargets.push(target);
    else excludedTargets.push(target);
  }

  return {
    source: {
      id: Number(sourceRow.id),
      orderNumber: String(sourceRow.po_number),
      status: String(sourceRow.status),
      updatedAt: sourceRow.updated_at ?? null,
      conflicts: sourceConflicts,
    },
    lines,
    eligibleTargets,
    excludedTargets,
  };
}