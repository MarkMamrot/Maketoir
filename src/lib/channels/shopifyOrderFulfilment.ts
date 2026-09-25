import { buildShopifyShipmentQuantities, parseShopifyShipment } from '@/lib/ims/shopifyFulfilment';
import { fulfilSalesOrderPartial } from '@/lib/ims/orderResolution/customerFulfilment';
import { persistShopifyShipment } from '@/lib/ims/shopifyShipmentPersistence';
import { imsQuery } from '@/services/IMSMySQLService';

type ShopifyFulfilmentTopic = 'fulfillments/create' | 'fulfillments/update' | 'orders/fulfilled';

export type ShopifyOrderFulfilmentResult = {
  outcome: 'fulfilled' | 'shipment_updated' | 'already_fulfilled';
  salesOrderId: number;
};

export async function applyShopifyOrderFulfilment(input: {
  businessId: string;
  channelInstanceId: string;
  topic: ShopifyFulfilmentTopic;
  payload: Record<string, any>;
}): Promise<ShopifyOrderFulfilmentResult> {
  const externalOrderId = String(input.topic.startsWith('fulfillments/')
    ? input.payload.order_id ?? ''
    : input.payload.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify fulfilment order ID is invalid.');
  const orders = await imsQuery<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance fulfilment.`);

  const shipment = input.topic.startsWith('fulfillments/') ? parseShopifyShipment(input.payload) : null;
  if (input.topic.startsWith('fulfillments/') && !shipment) {
    throw new Error('Shopify fulfilment payload is invalid.');
  }
  if (input.topic === 'fulfillments/update') {
    await persistShopifyShipment({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, soId: order.id, shipment: shipment!,
    });
    return { outcome: 'shipment_updated', salesOrderId: order.id };
  }
  if (order.status === 'fulfilled') {
    if (shipment) {
      await persistShopifyShipment({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId, soId: order.id, shipment,
      });
    }
    return { outcome: 'already_fulfilled', salesOrderId: order.id };
  }
  if (!['confirmed', 'partially_fulfilled'].includes(order.status)) {
    throw new Error(`Shopify order ${externalOrderId} cannot be fulfilled from status ${order.status}.`);
  }

  const orderItems = await imsQuery<{
    id: number; shopify_line_item_id: string | number | null; qty_ordered: number | string;
    qty_fulfilled: number | string | null;
  }>(
    `SELECT id, external_order_item_id AS shopify_line_item_id, qty_ordered, qty_fulfilled
       FROM ims_sales_order_items WHERE business_id = ? AND so_id = ? ORDER BY id`,
    [input.businessId, order.id],
  );
  const shipmentQuantities = buildShopifyShipmentQuantities({
    topic: input.topic,
    payloadLines: Array.isArray(input.payload.line_items)
      ? input.payload.line_items.map((line: any) => ({ id: line.id ?? line.line_item_id, quantity: line.quantity }))
      : [],
    orderItems,
  });
  const operationId = String(input.payload.id ?? externalOrderId);
  await fulfilSalesOrderPartial({
    businessId: input.businessId,
    soId: order.id,
    operationKey: `shopify:${input.channelInstanceId}:${input.topic}:${operationId}`,
    shipmentQuantities,
    allowIncomingCoveredStockShortfall: true,
    finalizeWhenComplete: true,
  });
  if (shipment) {
    await persistShopifyShipment({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, soId: order.id, shipment,
    });
  }
  return { outcome: 'fulfilled', salesOrderId: order.id };
}