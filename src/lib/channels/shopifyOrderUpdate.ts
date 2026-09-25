import { getContactChannelMapping } from '@/lib/ims/contactChannelMappings';
import { ImsSORepo, type ImsSOItem } from '@/lib/ims/ImsRepository';
import { recomputeBuildRequirementsSafely } from '@/lib/ims/builds/buildRequirementService';
import { parseShopifyOrderDeliveryAddress, parseShopifyOrderDeliveryMethod } from '@/lib/ims/shopifyOrderAddress';
import { getShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { getOrCreateOnlineFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export async function updateShopifyOrder(input: {
  businessId: string;
  channelInstanceId: string;
  order: Record<string, any>;
}): Promise<{ outcome: 'updated'; salesOrderId: number }> {
  const externalOrderId = String(input.order.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify order ID is invalid.');
  const orders = await imsQuery<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance update.`);

  const externalCustomerId = getShopifyOrderCustomerId(input.order);
  const customerMapping = externalCustomerId
    ? await getContactChannelMapping({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, externalCustomerId,
    })
    : null;
  const customerId = customerMapping?.mappingStatus === 'linked' ? customerMapping.contactId : null;
  const delivery = parseShopifyOrderDeliveryAddress(input.order);
  const deliveryMethod = parseShopifyOrderDeliveryMethod(input.order);
  const canReplaceLines = ['draft', 'confirmed'].includes(order.status) && Array.isArray(input.order.line_items);
  let items: Array<Omit<ImsSOItem, 'id' | 'so_id' | 'qty_fulfilled' | 'unit_cost' | 'sku' | 'product_name' | 'variant_label'>> | undefined;
  if (canReplaceLines) {
    const mappings = await imsQuery<{ external_variant_id: string; variant_id: string }>(
      `SELECT external_variant_id, variant_id FROM ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ?
          AND mapping_status = 'linked' AND variant_id IS NOT NULL`,
      [input.businessId, input.channelInstanceId],
    );
    const variantByExternalId = new Map(mappings.map(row => [String(row.external_variant_id), String(row.variant_id)]));
    const hasUnmappedLine = input.order.line_items.some((line: any) =>
      !variantByExternalId.has(String(line.variant_id ?? '')),
    );
    const fallbackVariantId = hasUnmappedLine ? await getOrCreateOnlineFallbackVariantId(input.businessId) : null;
    items = input.order.line_items.map((line: any) => {
      const externalItemId = text(line.id);
      const variantId = variantByExternalId.get(String(line.variant_id ?? '')) ?? fallbackVariantId;
      if (!variantId) throw new Error(`Shopify order ${externalOrderId} has no fallback variant.`);
      const quantity = Math.max(0, amount(line.quantity));
      const unitPrice = amount(line.price);
      return {
        shopify_line_item_id: externalItemId,
        external_order_item_id: externalItemId,
        variant_id: variantId,
        qty_ordered: quantity,
        unit_price: unitPrice,
        discount_pct: 0,
        tax_rate: 0.1,
        line_total: quantity * unitPrice,
        notes: text(line.name) ?? undefined,
      };
    });
    await ImsSORepo.update(order.id, {}, items);
  }

  const giftCardAmount = (Array.isArray(input.order.line_items) ? input.order.line_items : [])
    .filter((line: any) => Boolean(line?.gift_card))
    .reduce((sum: number, line: any) => sum + Math.max(0, amount(line.quantity)) * Math.max(0, amount(line.price)), 0);
  const gateway = Array.isArray(input.order.payment_gateway_names)
    ? input.order.payment_gateway_names.map(String).join(', ')
    : text(input.order.gateway);
  await imsExecute(
    `UPDATE ims_sales_orders
        SET subtotal = ?, tax_amount = ?, total_amount = ?, freight = ?, discount = ?,
            gift_card_amount = ?, customer_id = COALESCE(?, customer_id),
            financial_status = COALESCE(?, financial_status), payment_gateway = COALESCE(?, payment_gateway),
            shopify_order_name = COALESCE(?, shopify_order_name),
            delivery_address = ?, delivery_address2 = ?, delivery_suburb = ?, delivery_city = ?,
            delivery_state = ?, delivery_postcode = ?, delivery_country = ?,
            channel_shipping_method = ?, channel_delivery_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND business_id = ? AND channel_instance_id = ?`,
    [amount(input.order.subtotal_price), amount(input.order.total_tax), amount(input.order.total_price),
      amount(input.order.total_shipping_price_set?.shop_money?.amount), amount(input.order.total_discounts),
      Math.round(giftCardAmount * 100) / 100, customerId, text(input.order.financial_status), gateway,
      text(input.order.name), delivery.delivery_address, delivery.delivery_address2, delivery.delivery_suburb,
      delivery.delivery_city, delivery.delivery_state, delivery.delivery_postcode, delivery.delivery_country,
      deliveryMethod.channel_shipping_method, deliveryMethod.channel_delivery_type,
      order.id, input.businessId, input.channelInstanceId],
  );
  if (canReplaceLines) {
    await recomputeBuildRequirementsSafely({
      businessId: input.businessId, salesOrderId: order.id, sourceChannel: 'shopify',
    });
  }
  return { outcome: 'updated', salesOrderId: order.id };
}