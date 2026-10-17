import { getContactChannelMapping } from '@/lib/ims/contactChannelMappings';
import { ImsSORepo, type SalesOrderUpdateItem } from '@/lib/ims/ImsRepository';
import { recomputeBuildRequirementsForSalesOrder, recomputeBuildRequirementsSafely } from '@/lib/ims/builds/buildRequirementService';
import { parseShopifyOrderDeliveryAddress, parseShopifyOrderDeliveryMethod } from '@/lib/ims/shopifyOrderAddress';
import { getShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { getOrCreateOnlineFallbackVariantId } from '@/lib/shopifyFallbackVariant';
import type { PoolConnection } from 'mysql2/promise';
import { localTransactionQueries } from '@/lib/ims/localTransactionQueries';
import { lockInventoryCostState } from '@/lib/ims/costing/fifoCostingService';
import { ShopifyOrderReviewRequiredError } from '@/lib/ims/shopifyOrderReview';

import { assertShopifyOrderLineMappings, loadShopifyOrderMappings, reportUnmappedShopifyOrderLines, unmappedTrackedShopifyOrderLines } from './shopifyOrderLineMapping';

export class ShopifyOrderImportPendingError extends Error {
  constructor(externalOrderId: string) {
    super(`Shopify order ${externalOrderId} is not available for exact-instance update.`);
    this.name = 'ShopifyOrderImportPendingError';
  }
}

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export type ShopifyOrderUpdateInput = {
  businessId: string;
  channelInstanceId: string;
  order: Record<string, any>;
};
export type ShopifyOrderUpdateResult = { outcome: 'updated'; salesOrderId: number };

export async function updateShopifyOrderInTransaction(
  connection: PoolConnection, input: ShopifyOrderUpdateInput,
): Promise<ShopifyOrderUpdateResult> {
  if (!input.businessId.trim() || !input.channelInstanceId.trim()) throw new Error('Business and channel instance identity are required.');
  return updateShopifyOrderLocal(input, connection);
}

export async function updateShopifyOrder(input: ShopifyOrderUpdateInput): Promise<ShopifyOrderUpdateResult> {
  return updateShopifyOrderLocal(input);
}

async function updateShopifyOrderLocal(input: ShopifyOrderUpdateInput, connection?: PoolConnection): Promise<ShopifyOrderUpdateResult> {
  const externalOrderId = String(input.order.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify order ID is invalid.');
  if (connection) await lockInventoryCostState(connection, input.businessId);
  const { query: imsQuery, execute: imsExecute } = localTransactionQueries(connection);
  const orders = await imsQuery<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1${connection ? ' FOR UPDATE' : ''}`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new ShopifyOrderImportPendingError(externalOrderId);

  const externalCustomerId = getShopifyOrderCustomerId(input.order);
  const customerMapping = externalCustomerId
    ? await getContactChannelMapping({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, externalCustomerId,
    }, ...(connection ? [connection] as const : []))
    : null;
  const customerId = customerMapping?.mappingStatus === 'linked' ? customerMapping.contactId : null;
  const delivery = parseShopifyOrderDeliveryAddress(input.order);
  const deliveryMethod = parseShopifyOrderDeliveryMethod(input.order);
  const canReplaceLines = ['draft', 'confirmed'].includes(order.status) && Array.isArray(input.order.line_items);
  let items: SalesOrderUpdateItem[] | undefined;
  let unmappedTrackedLines = [] as ReturnType<typeof unmappedTrackedShopifyOrderLines>;
  if (canReplaceLines) {
    type RefundLine = { line_item_id?: unknown; line_item?: { id?: unknown } };
    type Refund = { refund_line_items?: RefundLine[] };
    const refundedLineIds = new Set<string>(connection && Array.isArray(input.order.refunds)
      ? (input.order.refunds as Refund[]).flatMap(refund => Array.isArray(refund.refund_line_items)
        ? refund.refund_line_items.map(line => String(line.line_item_id ?? line.line_item?.id ?? ''))
        : [])
      : []);
    // Refunded current_quantity is a net balance, not the original stock/cost source quantity.
    const sourceQuantity = (line: Record<string, unknown>) => amount(refundedLineIds.has(String(line.id))
      ? line.quantity : line.current_quantity ?? line.quantity);
    const activeLines = input.order.line_items.filter((line: any) =>
      sourceQuantity(line) > 0,
    );
    const mappings = connection
      ? await loadShopifyOrderMappings(connection, input.businessId, input.channelInstanceId)
      : await imsQuery<{ external_variant_id: string; variant_id: string }>(
      `SELECT external_variant_id, variant_id FROM ims_sales_channel_product_mappings
        WHERE business_id = ? AND channel_instance_id = ?
          AND mapping_status = 'linked' AND variant_id IS NOT NULL`,
      [input.businessId, input.channelInstanceId],
    );
    const variantByExternalId = new Map(mappings.map(row => [String(row.external_variant_id), String(row.variant_id)]));
    if (connection) assertShopifyOrderLineMappings(activeLines, mappings);
    unmappedTrackedLines = unmappedTrackedShopifyOrderLines(
      activeLines,
      new Set(variantByExternalId.keys()),
    );
    const hasUnmappedLine = activeLines.some((line: any) =>
      !variantByExternalId.has(String(line.variant_id ?? '')),
    );
    const fallbackVariantId = hasUnmappedLine
      ? await getOrCreateOnlineFallbackVariantId(input.businessId, ...(connection ? [connection] as const : []))
      : null;
    const sourceItems = connection ? await imsQuery<{ id: number; external_order_item_id: string }>(
      'SELECT id, external_order_item_id FROM ims_sales_order_items WHERE business_id = ? AND so_id = ? ORDER BY id FOR UPDATE',
      [input.businessId, order.id],
    ) : [];
    if (connection) {
      const ids = activeLines.map((line: Record<string, unknown>) => text(line.id));
      if (ids.some((id: string | null) => !id) || new Set(ids).size !== ids.length) {
        throw new ShopifyOrderReviewRequiredError(
          'invalid_source_line_identity', 'Shopify source line identities must be present and unique.',
        );
      }
    }
    items = activeLines.map((line: any) => {
      const externalItemId = text(line.id);
      const variantId = variantByExternalId.get(String(line.variant_id ?? '')) ?? fallbackVariantId;
      if (!variantId) throw new Error(`Shopify order ${externalOrderId} has no fallback variant.`);
      const quantity = Math.max(0, sourceQuantity(line));
      const unitPrice = amount(line.price);
      return {
        ...(connection ? { id: sourceItems.find(item => String(item.external_order_item_id) === externalItemId)?.id } : {}),
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
    if (connection) await ImsSORepo.updateInTransaction(connection, input.businessId, order.id, {}, items);
    else await ImsSORepo.update(order.id, {}, items);
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
    const buildInput = {
      businessId: input.businessId, salesOrderId: order.id, sourceChannel: 'shopify',
    };
    if (connection) {
      await recomputeBuildRequirementsForSalesOrder(buildInput, connection);
      return { outcome: 'updated', salesOrderId: order.id };
    }
    await recomputeBuildRequirementsSafely(buildInput);
    await reportUnmappedShopifyOrderLines({
      businessId: input.businessId,
      channelInstanceId: input.channelInstanceId,
      externalOrderId,
      externalOrderName: text(input.order.name),
      lines: unmappedTrackedLines,
    }).catch(() => undefined);
  }
  return { outcome: 'updated', salesOrderId: order.id };
}