import { getContactChannelMapping } from '@/lib/ims/contactChannelMappings';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { recomputeBuildRequirementsSafely } from '@/lib/ims/builds/buildRequirementService';
import { parseShopifyOrderDeliveryAddress, parseShopifyOrderDeliveryMethod } from '@/lib/ims/shopifyOrderAddress';
import { getOrCreateOnlineCustomerId, getShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { getOrCreateOnlineFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import { toBusinessDateTime } from '@/lib/shopifyDate';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

type ShopifyOrderPayload = Record<string, any>;

export type ShopifyOrderImportResult = {
  outcome: 'imported' | 'updated' | 'skipped';
  salesOrderId: number | null;
};

export type ShopifyOrderCancellationResult = {
  outcome: 'cancelled' | 'already_cancelled';
  salesOrderId: number;
};

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export async function cancelShopifyOrder(input: {
  businessId: string;
  channelInstanceId: string;
  order: ShopifyOrderPayload;
}): Promise<ShopifyOrderCancellationResult> {
  const externalOrderId = String(input.order.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify order ID is invalid.');
  const rows = await imsQuery<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = rows[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance cancellation.`);
  if (order.status === 'cancelled') return { outcome: 'already_cancelled', salesOrderId: order.id };

  await ImsSORepo.changeStatus(order.id, 'cancelled');
  await recomputeBuildRequirementsSafely({
    businessId: input.businessId,
    salesOrderId: order.id,
    sourceChannel: 'shopify',
  });
  return { outcome: 'cancelled', salesOrderId: order.id };
}

export async function importShopifyOrder(input: {
  businessId: string;
  channelInstanceId: string;
  locationId: number;
  topic: 'orders/create' | 'orders/paid';
  order: ShopifyOrderPayload;
}): Promise<ShopifyOrderImportResult> {
  const externalOrderId = String(input.order.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify order ID is invalid.');
  const locationId = Math.floor(Number(input.locationId));
  if (!Number.isInteger(locationId) || locationId <= 0) throw new Error('Shopify order location is not configured.');
  const delivery = parseShopifyOrderDeliveryAddress(input.order);
  const deliveryMethod = parseShopifyOrderDeliveryMethod(input.order);
  const financialStatus = input.topic === 'orders/paid' ? 'paid' : text(input.order.financial_status);
  const existingRows = await imsQuery<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const existing = existingRows[0];
  if (existing) {
    await imsExecute(
      `UPDATE ims_sales_orders
          SET financial_status = ?, shopify_order_name = COALESCE(?, shopify_order_name),
              delivery_address = ?, delivery_address2 = ?, delivery_suburb = ?, delivery_city = ?,
              delivery_state = ?, delivery_postcode = ?, delivery_country = ?,
              channel_shipping_method = ?, channel_delivery_type = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
      [financialStatus, text(input.order.name), delivery.delivery_address, delivery.delivery_address2,
        delivery.delivery_suburb, delivery.delivery_city, delivery.delivery_state, delivery.delivery_postcode,
        delivery.delivery_country, deliveryMethod.channel_shipping_method, deliveryMethod.channel_delivery_type,
        existing.id, input.businessId, input.channelInstanceId],
    );
    if (existing.status === 'draft') await ImsSORepo.changeStatus(existing.id, 'confirmed');
    return { outcome: 'updated', salesOrderId: existing.id };
  }

  const lines = Array.isArray(input.order.line_items) ? input.order.line_items : [];
  if (lines.length === 0) return { outcome: 'skipped', salesOrderId: null };
  const mappingRows = await imsQuery<{ external_variant_id: string; variant_id: string }>(
    `SELECT external_variant_id, variant_id FROM ims_sales_channel_product_mappings
      WHERE business_id = ? AND channel_instance_id = ?
        AND mapping_status = 'linked' AND variant_id IS NOT NULL`,
    [input.businessId, input.channelInstanceId],
  );
  const variantByExternalId = new Map(mappingRows.map(row => [String(row.external_variant_id), String(row.variant_id)]));
  const fallbackVariantId = lines.some(line => !variantByExternalId.has(String(line.variant_id ?? '')))
    ? await getOrCreateOnlineFallbackVariantId(input.businessId)
    : null;
  const fallbackCustomerId = await getOrCreateOnlineCustomerId(input.businessId);
  const externalCustomerId = getShopifyOrderCustomerId(input.order);
  const customerMapping = externalCustomerId
    ? await getContactChannelMapping({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, externalCustomerId,
    })
    : null;
  const customerId = customerMapping?.mappingStatus === 'linked' ? customerMapping.contactId : fallbackCustomerId;
  const gateway = Array.isArray(input.order.payment_gateway_names)
    ? input.order.payment_gateway_names.map(String).join(', ')
    : text(input.order.gateway);
  const freight = amount(input.order.total_shipping_price_set?.shop_money?.amount);
  const subtotal = amount(input.order.subtotal_price);
  const taxAmount = amount(input.order.total_tax);
  const totalAmount = amount(input.order.total_price);
  const discount = amount(input.order.total_discounts);
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  let salesOrderId = 0;
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute<any>(
      `INSERT INTO ims_sales_orders
         (business_id, so_number, so_type, sales_channel, channel_instance_id, external_order_id,
          customer_id, location_id, status, order_date, freight, discount, subtotal, tax_amount,
          total_amount, currency_code, exchange_rate, shopify_order_id, shopify_order_name,
          payment_gateway, financial_status, delivery_address, delivery_address2, delivery_suburb,
          delivery_city, delivery_state, delivery_postcode, delivery_country, channel_shipping_method,
          channel_delivery_type, price_tier, tax_treatment, notes)
       VALUES (?, ?, 'online', 'shopify', ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retail', 'inc_tax', ?)`,
      [input.businessId, `SHP-${input.channelInstanceId.slice(0, 8)}-${externalOrderId}`.slice(0, 50),
        input.channelInstanceId, externalOrderId, customerId, locationId,
        toBusinessDateTime(input.order.created_at ?? input.order.processed_at), freight, discount, subtotal,
        taxAmount, totalAmount, text(input.order.currency) ?? 'AUD', externalOrderId, text(input.order.name),
        gateway, financialStatus, delivery.delivery_address, delivery.delivery_address2,
        delivery.delivery_suburb, delivery.delivery_city, delivery.delivery_state, delivery.delivery_postcode,
        delivery.delivery_country, deliveryMethod.channel_shipping_method, deliveryMethod.channel_delivery_type,
        `Shopify ${text(input.order.name) ?? externalOrderId}`],
    );
    salesOrderId = Number(created.insertId);
    for (const line of lines) {
      const externalVariantId = String(line.variant_id ?? '');
      const variantId = variantByExternalId.get(externalVariantId) ?? fallbackVariantId;
      if (!variantId) throw new Error(`Shopify order ${externalOrderId} has no fallback variant.`);
      const quantity = Math.max(0, amount(line.quantity));
      const unitPrice = amount(line.price);
      await connection.execute(
        `INSERT INTO ims_sales_order_items
           (business_id, so_id, shopify_line_item_id, external_order_item_id, variant_id,
            qty_ordered, qty_fulfilled, unit_price, discount_pct, tax_rate, line_total, notes)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0.1, ?, ?)`,
        [input.businessId, salesOrderId, text(line.id), text(line.id), variantId, quantity,
          unitPrice, quantity * unitPrice, text(line.name)],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await ImsSORepo.changeStatus(salesOrderId, 'confirmed');
  return { outcome: 'imported', salesOrderId };
}