import { getIMSPool } from '@/services/IMSMySQLService';
import { previewSalesOrderSourcing } from '../salesOrderSourcing';
import {
  calculateOrderTransferQuantityRules,
  getOrderTransferConflicts,
  getOrderTransferDocumentConflicts,
  type OrderTransferDocument,
  type OrderTransferQuantityRules,
} from './domain';

export class OrderTransferPreviewConflict extends Error {
  readonly code = 'order_transfer_preview_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'OrderTransferPreviewConflict';
  }
}

type SalesOrderPreviewRow = {
  id: number;
  so_number: string;
  business_id: string;
  customer_id: number | null;
  customer_name: string | null;
  location_id: number;
  location_name: string | null;
  order_date: string | null;
  status: string;
  currency_code: string;
  exchange_rate: number | string | null;
  tax_treatment: string;
  tax_code: string | null;
  payment_terms: string | null;
  price_tier: string | null;
  customer_po_number: string | null;
  so_type: string | null;
  is_historical: number | null;
  xero_invoice_id: string | null;
  has_payments: number | string;
  has_submitted_shipment: number | string;
  outstanding_quantity: number | string;
  updated_at: string | null;
};

export type SalesOrderTransferPreviewLine = {
  itemId: number;
  variantId: string;
  sku: string | null;
  productName: string;
  orderedQuantity: number;
  processedQuantity: number;
  rules: OrderTransferQuantityRules;
};

export type SalesOrderTransferTarget = {
  id: number;
  orderNumber: string;
  updatedAt: string | null;
  customerName: string | null;
  locationName: string | null;
  orderDate: string | null;
  status: string;
  externalReference: string | null;
  outstandingQuantity: number;
  conflicts: string[];
};

export type SalesOrderTransferPreview = {
  source: {
    id: number;
    orderNumber: string;
    status: string;
    updatedAt: string | null;
    conflicts: string[];
  };
  lines: SalesOrderTransferPreviewLine[];
  eligibleTargets: SalesOrderTransferTarget[];
  excludedTargets: SalesOrderTransferTarget[];
};

function asTransferDocument(row: SalesOrderPreviewRow): OrderTransferDocument {
  return {
    id: Number(row.id),
    kind: 'sales_order',
    businessId: String(row.business_id),
    contactId: row.customer_id == null ? null : Number(row.customer_id),
    locationId: Number(row.location_id),
    currencyCode: String(row.currency_code ?? 'AUD'),
    exchangeRate: Number(row.exchange_rate ?? 1),
    taxTreatment: String(row.tax_treatment ?? 'ex_tax'),
    taxCode: row.tax_code ?? null,
    paymentTerms: row.payment_terms ?? null,
    priceTier: row.price_tier ?? null,
    externalReference: row.customer_po_number ?? null,
    status: String(row.status),
    hasPayments: Boolean(Number(row.has_payments ?? 0)),
    xeroDocumentId: row.xero_invoice_id ?? null,
    xeroDocumentStatus: row.xero_invoice_id ? 'UNKNOWN' : null,
    hasSubmittedShipment: Boolean(Number(row.has_submitted_shipment ?? 0)),
    commerciallyEditable: !Number(row.is_historical ?? 0) && String(row.so_type ?? 'b2b') !== 'online',
  };
}

function asTarget(row: SalesOrderPreviewRow, conflicts: string[]): SalesOrderTransferTarget {
  return {
    id: Number(row.id),
    orderNumber: String(row.so_number),
    updatedAt: row.updated_at ?? null,
    customerName: row.customer_name ?? null,
    locationName: row.location_name ?? null,
    orderDate: row.order_date ?? null,
    status: String(row.status),
    externalReference: row.customer_po_number ?? null,
    outstandingQuantity: Number(row.outstanding_quantity ?? 0),
    conflicts,
  };
}

export async function previewSalesOrderTransfer(input: {
  businessId: string;
  sourceOrderId: number;
}): Promise<SalesOrderTransferPreview> {
  const pool = getIMSPool();
  const [sourceRows] = await pool.execute<SalesOrderPreviewRow[]>(
    `SELECT so.id, so.so_number, so.business_id, so.customer_id, customer.name AS customer_name,
            so.location_id, location.name AS location_name, so.order_date, so.status,
            so.currency_code, so.exchange_rate, so.tax_treatment, so.tax_code, so.payment_terms,
            so.price_tier, so.customer_po_number, so.so_type, so.is_historical,
            so.xero_invoice_id, so.updated_at,
            EXISTS(SELECT 1 FROM ims_sales_order_payments payment
                    WHERE payment.business_id = so.business_id AND payment.so_id = so.id) AS has_payments,
            EXISTS(SELECT 1 FROM ims_shipping_shipments shipment
                    WHERE shipment.business_id = so.business_id AND shipment.so_id = so.id
                      AND (shipment.provider_shipment_id IS NOT NULL
                           OR shipment.status NOT IN ('draft','quoting','failed'))) AS has_submitted_shipment,
            COALESCE((SELECT SUM(GREATEST(0, item.qty_ordered - item.qty_fulfilled))
                        FROM ims_sales_order_items item
                       WHERE item.business_id = so.business_id AND item.so_id = so.id), 0) AS outstanding_quantity
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts customer ON customer.id = so.customer_id AND customer.business_id = so.business_id
       LEFT JOIN ims_locations location ON location.id = so.location_id AND location.business_id = so.business_id
      WHERE so.business_id = ? AND so.id = ?
      LIMIT 1`,
    [input.businessId, input.sourceOrderId],
  );
  const sourceRow = sourceRows[0];
  if (!sourceRow) throw new OrderTransferPreviewConflict('Sales order was not found.');

  const sourcing = await previewSalesOrderSourcing({
    businessId: input.businessId,
    soId: input.sourceOrderId,
  });
  const sourceDocument = asTransferDocument(sourceRow);
  const sourceConflicts = getOrderTransferDocumentConflicts(sourceDocument, 'Source');

  const [candidateRows] = await pool.execute<SalesOrderPreviewRow[]>(
    `SELECT so.id, so.so_number, so.business_id, so.customer_id, customer.name AS customer_name,
            so.location_id, location.name AS location_name, so.order_date, so.status,
            so.currency_code, so.exchange_rate, so.tax_treatment, so.tax_code, so.payment_terms,
            so.price_tier, so.customer_po_number, so.so_type, so.is_historical,
            so.xero_invoice_id, so.updated_at,
            EXISTS(SELECT 1 FROM ims_sales_order_payments payment
                    WHERE payment.business_id = so.business_id AND payment.so_id = so.id) AS has_payments,
            EXISTS(SELECT 1 FROM ims_shipping_shipments shipment
                    WHERE shipment.business_id = so.business_id AND shipment.so_id = so.id
                      AND (shipment.provider_shipment_id IS NOT NULL
                           OR shipment.status NOT IN ('draft','quoting','failed'))) AS has_submitted_shipment,
            COALESCE((SELECT SUM(GREATEST(0, item.qty_ordered - item.qty_fulfilled))
                        FROM ims_sales_order_items item
                       WHERE item.business_id = so.business_id AND item.so_id = so.id), 0) AS outstanding_quantity
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts customer ON customer.id = so.customer_id AND customer.business_id = so.business_id
       LEFT JOIN ims_locations location ON location.id = so.location_id AND location.business_id = so.business_id
      WHERE so.business_id = ? AND so.id <> ?
        AND so.status IN ('draft','confirmed','partially_fulfilled','backordered')
      ORDER BY (so.customer_id = ?) DESC, so.order_date DESC, so.id DESC
      LIMIT 100`,
    [input.businessId, input.sourceOrderId, sourceRow.customer_id],
  );

  const targets = candidateRows.map(row => {
    const conflicts = getOrderTransferConflicts(sourceDocument, asTransferDocument(row));
    return asTarget(row, conflicts);
  });

  return {
    source: {
      id: Number(sourceRow.id),
      orderNumber: String(sourceRow.so_number),
      status: String(sourceRow.status),
      updatedAt: sourceRow.updated_at ?? null,
      conflicts: sourceConflicts,
    },
    lines: sourcing.lines
      .filter(line => line.outstanding > 0)
      .map(line => ({
        itemId: line.soItemId,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        orderedQuantity: line.ordered,
        processedQuantity: line.ordered - line.outstanding,
        rules: calculateOrderTransferQuantityRules({
          orderedQuantity: line.ordered,
          processedQuantity: line.ordered - line.outstanding,
          readyQuantity: line.availableNow,
          allocatedIncomingQuantity: line.allocatedIncoming,
        }),
      })),
    eligibleTargets: targets.filter(target => target.conflicts.length === 0),
    excludedTargets: targets.filter(target => target.conflicts.length > 0),
  };
}