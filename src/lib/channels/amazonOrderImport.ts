import { normalizeAmazonOrder } from '@/lib/channels/amazonOrderNormalization';
import type { AmazonOrder, AmazonOrderItem } from '@/lib/channels/amazonSpApi';
import { getOrCreateOnlineCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { fulfilSalesOrderPartial } from '@/lib/ims/orderResolution/customerFulfilment';
import { getOrCreateOnlineFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import { toBusinessDateTime } from '@/lib/shopifyDate';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface ExistingAmazonOrderRow {
  id: number;
  status: string;
}

export interface AmazonOrderImportResult {
  outcome: 'imported' | 'updated' | 'skipped';
  salesOrderId: number | null;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

async function applyAmazonOrderStatus(input: {
  businessId: string;
  salesOrderId: number;
  currentStatus: string;
  order: ReturnType<typeof normalizeAmazonOrder>;
}): Promise<void> {
  const { businessId, salesOrderId, order } = input;
  const amazonStatus = order.status;
  if (amazonStatus === 'Canceled') {
    if (input.currentStatus !== 'cancelled' && input.currentStatus !== 'fulfilled') {
      await ImsSORepo.changeStatus(salesOrderId, 'cancelled');
    }
    return;
  }
  let status = input.currentStatus;
  if (status === 'draft') {
    await ImsSORepo.changeStatus(salesOrderId, 'confirmed');
    status = 'confirmed';
  }
  if (!['PartiallyShipped', 'Shipped', 'InvoiceUnconfirmed'].includes(amazonStatus)
    || !['confirmed', 'partially_fulfilled'].includes(status)) return;

  const itemRows = await imsQuery<{
    id: number;
    external_order_item_id: string;
    qty_ordered: number | string;
    qty_fulfilled: number | string;
  }>(
    `SELECT id, external_order_item_id, qty_ordered, qty_fulfilled
       FROM ims_sales_order_items WHERE business_id = ? AND so_id = ?`,
    [businessId, salesOrderId],
  );
  const observedByItem = new Map(order.lines.map(line => [line.externalOrderItemId,
    amazonStatus === 'Shipped' || amazonStatus === 'InvoiceUnconfirmed' ? line.quantityOrdered : line.quantityShipped]));
  const shipmentQuantities = itemRows.map(item => ({
    itemId: Number(item.id),
    quantity: Math.max(0, Math.min(Number(item.qty_ordered), Number(observedByItem.get(String(item.external_order_item_id)) ?? 0))
      - Number(item.qty_fulfilled ?? 0)),
  })).filter(item => item.quantity > 0);
  if (shipmentQuantities.length > 0) {
    await fulfilSalesOrderPartial({
      businessId,
      soId: salesOrderId,
      operationKey: `amazon:observed:${order.amazonOrderId}:${order.lastUpdatedAt}`.slice(0, 191),
      shipmentQuantities,
      allowIncomingCoveredStockShortfall: true,
      finalizeWhenComplete: true,
    });
  }
}

export async function importAmazonOrder(input: {
  businessId: string;
  channelInstanceId: string;
  locationId: number;
  order: AmazonOrder;
  items: AmazonOrderItem[];
}): Promise<AmazonOrderImportResult> {
  const normalized = normalizeAmazonOrder(input.order, input.items);
  const existingRows = await imsQuery<ExistingAmazonOrderRow>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND channel_instance_id = ? AND external_order_id = ?
      LIMIT 1`,
    [input.businessId, input.channelInstanceId, normalized.amazonOrderId],
  );
  const existing = existingRows[0];
  if (existing) {
    await imsExecute(
      `UPDATE ims_sales_orders
          SET financial_status = 'paid', payment_gateway = ?,
              delivery_address = ?, delivery_address2 = ?, delivery_suburb = ?, delivery_city = ?,
              delivery_state = ?, delivery_postcode = ?, delivery_country = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
      [normalized.paymentGateway, text(normalized.address.AddressLine1),
        text([normalized.address.AddressLine2, normalized.address.AddressLine3].filter(Boolean).join(', ')),
        text(normalized.address.City), text(normalized.address.City), text(normalized.address.StateOrRegion),
        text(normalized.address.PostalCode), text(normalized.address.CountryCode), existing.id,
        input.businessId, input.channelInstanceId],
    );
    await applyAmazonOrderStatus({
      businessId: input.businessId, salesOrderId: existing.id, currentStatus: existing.status, order: normalized,
    });
    return { outcome: 'updated', salesOrderId: existing.id };
  }
  if (normalized.status === 'Canceled') return { outcome: 'skipped', salesOrderId: null };

  const mappingRows = await imsQuery<{ external_variant_id: string; variant_id: string }>(
    `SELECT external_variant_id, variant_id
       FROM ims_sales_channel_product_mappings
      WHERE business_id = ? AND channel_instance_id = ?
        AND mapping_status = 'linked' AND variant_id IS NOT NULL`,
    [input.businessId, input.channelInstanceId],
  );
  const variantBySku = new Map(mappingRows.map(row => [String(row.external_variant_id), String(row.variant_id)]));
  const fallbackVariantId = normalized.lines.some(line => !line.sellerSku || !variantBySku.has(line.sellerSku))
    ? await getOrCreateOnlineFallbackVariantId(input.businessId)
    : null;
  const customerId = await getOrCreateOnlineCustomerId(input.businessId);
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  let salesOrderId = 0;
  try {
    await connection.beginTransaction();
    const orderDate = toBusinessDateTime(normalized.purchasedAt);
    const soNumber = `AMZ-${normalized.amazonOrderId}`.slice(0, 50);
    const [created] = await connection.execute<any>(
      `INSERT INTO ims_sales_orders
         (business_id, so_number, so_type, sales_channel, channel_instance_id, external_order_id,
          customer_id, location_id, status, order_date, freight, discount, subtotal, tax_amount,
          total_amount, currency_code, exchange_rate, payment_gateway, financial_status,
          delivery_address, delivery_address2, delivery_suburb, delivery_city, delivery_state,
          delivery_postcode, delivery_country, customer_po_number, price_tier, tax_treatment, notes)
       VALUES (?, ?, 'online', 'amazon', ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?, ?, ?, 1,
               ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, 'retail', 'inc_tax', ?)`,
      [input.businessId, soNumber, input.channelInstanceId, normalized.amazonOrderId,
        customerId, input.locationId, orderDate, normalized.freight, normalized.subtotal,
        normalized.taxAmount, normalized.totalAmount, normalized.currencyCode, normalized.paymentGateway,
        text(normalized.address.AddressLine1),
        text([normalized.address.AddressLine2, normalized.address.AddressLine3].filter(Boolean).join(', ')),
        text(normalized.address.City), text(normalized.address.City), text(normalized.address.StateOrRegion),
        text(normalized.address.PostalCode), text(normalized.address.CountryCode),
        text(input.order.BuyerInfo?.PurchaseOrderNumber), `Amazon order ${normalized.amazonOrderId}`],
    );
    salesOrderId = Number(created.insertId);
    for (const line of normalized.lines) {
      const variantId = variantBySku.get(line.sellerSku) ?? fallbackVariantId;
      if (!variantId) throw new Error(`Amazon order ${normalized.amazonOrderId} has no fallback variant.`);
      await connection.execute(
        `INSERT INTO ims_sales_order_items
           (business_id, so_id, external_order_item_id, variant_id, qty_ordered, qty_fulfilled,
            unit_price, discount_pct, tax_rate, line_total, notes)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
        [input.businessId, salesOrderId, line.externalOrderItemId, variantId, line.quantityOrdered,
          line.unitPrice, line.taxRate, line.lineTotal, line.title],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await applyAmazonOrderStatus({
    businessId: input.businessId, salesOrderId, currentStatus: 'draft', order: normalized,
  });
  return { outcome: 'imported', salesOrderId };
}