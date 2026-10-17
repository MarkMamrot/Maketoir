import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { buildShopifyShipmentQuantities, hasRecordedShopifyFulfilmentQuantities, parseShopifyShipment, type ShopifyFulfilmentOperation, type ShopifyShipment } from '@/lib/ims/shopifyFulfilment';
import { fulfilSalesOrderPartial, fulfilSalesOrderPartialInTransaction } from '@/lib/ims/orderResolution/customerFulfilment';
import { persistShopifyShipment, persistShopifyShipmentInTransaction } from '@/lib/ims/shopifyShipmentPersistence';
import { imsQuery } from '@/services/IMSMySQLService';
import { lockInventoryCostState } from '@/lib/ims/costing/fifoCostingService';
import { ShopifyOrderReviewRequiredError } from '@/lib/ims/shopifyOrderReview';
import { StockShortfallError } from '@/lib/ims/orderResolution/stockShortfall';
import { ProtectedStockConflict, SalesOrderPriorityConflict } from '@/lib/ims/stockAllocation/readinessService';

type ShopifyFulfilmentTopic = 'fulfillments/create' | 'fulfillments/update' | 'orders/fulfilled';

export type ShopifyOrderFulfilmentResult = {
  outcome: 'fulfilled' | 'shipment_updated' | 'already_fulfilled';
  salesOrderId: number;
};

export type ShopifyOrderFulfilmentInput = {
  businessId: string;
  channelInstanceId: string;
  topic: ShopifyFulfilmentTopic;
  payload: Record<string, unknown>;
};

export async function applyShopifyOrderFulfilment(input: ShopifyOrderFulfilmentInput): Promise<ShopifyOrderFulfilmentResult> {
  return processShopifyOrderFulfilment(input);
}

export async function applyShopifyOrderFulfilmentInTransaction(
  connection: PoolConnection,
  input: ShopifyOrderFulfilmentInput,
): Promise<ShopifyOrderFulfilmentResult> {
  return processShopifyOrderFulfilment(input, connection);
}

async function processShopifyOrderFulfilment(
  input: ShopifyOrderFulfilmentInput,
  connection?: PoolConnection,
): Promise<ShopifyOrderFulfilmentResult> {
  if (connection) await lockInventoryCostState(connection, input.businessId);
  const query = async <T>(sql: string, values: Array<string | number>): Promise<T[]> => {
    if (!connection) return imsQuery<T>(sql, values);
    const [rows] = await connection.execute<(T & RowDataPacket)[]>(sql, values);
    return rows;
  };
  const externalOrderId = String(input.topic.startsWith('fulfillments/')
    ? input.payload.order_id ?? ''
    : input.payload.id ?? '').trim();
  if (!/^\d+$/.test(externalOrderId)) throw new Error('Shopify fulfilment order ID is invalid.');
  const orders = await query<{ id: number; status: string }>(
    `SELECT id, status FROM ims_sales_orders
      WHERE business_id = ? AND sales_channel = 'shopify'
        AND channel_instance_id = ? AND external_order_id = ? LIMIT 1`,
    [input.businessId, input.channelInstanceId, externalOrderId],
  );
  const order = orders[0];
  if (!order) throw new Error(`Shopify order ${externalOrderId} is not available for exact-instance fulfilment.`);
  const persist = (shipment: ShopifyShipment) => {
    const shipmentInput = { businessId: input.businessId, channelInstanceId: input.channelInstanceId, soId: order.id, shipment };
    return connection ? persistShopifyShipmentInTransaction(connection, shipmentInput) : persistShopifyShipment(shipmentInput);
  };

  const shipment = input.topic.startsWith('fulfillments/') ? parseShopifyShipment(input.payload) : null;
  if (input.topic.startsWith('fulfillments/') && !shipment) {
    throw new Error('Shopify fulfilment payload is invalid.');
  }
  if (input.topic === 'fulfillments/update') {
    await persist(shipment!);
    return { outcome: 'shipment_updated', salesOrderId: order.id };
  }
  if (order.status === 'fulfilled') {
    if (shipment) {
      await persist(shipment);
    }
    return { outcome: 'already_fulfilled', salesOrderId: order.id };
  }
  if (!['confirmed', 'partially_fulfilled'].includes(order.status)) {
    throw new Error(`Shopify order ${externalOrderId} cannot be fulfilled from status ${order.status}.`);
  }
  if (connection && input.topic === 'orders/fulfilled'
    && Array.isArray(input.payload.refunds) && input.payload.refunds.length > 0) {
    throw new ShopifyOrderReviewRequiredError(
      'source_provenance_conflict', 'Refunded orders require explicit shipment history before additional stock can be fulfilled.',
    );
  }

  const orderItems = await query<{
    id: number; shopify_line_item_id: string | number | null; qty_ordered: number | string;
    qty_fulfilled: number | string | null;
  }>(
    `SELECT id, external_order_item_id AS shopify_line_item_id, qty_ordered, qty_fulfilled
       FROM ims_sales_order_items WHERE business_id = ? AND so_id = ? ORDER BY id${connection ? ' FOR UPDATE' : ''}`,
    [input.businessId, order.id],
  );
  if (connection && orderItems.some(item => Number(item.qty_fulfilled) > 0)) {
    const operations = await query<ShopifyFulfilmentOperation>(
      `SELECT operation_key,request_json FROM ims_so_fulfilment_operations
       WHERE business_id = ? AND so_id = ? AND status = 'complete' FOR UPDATE`,
      [input.businessId, order.id],
    );
    if (!hasRecordedShopifyFulfilmentQuantities({
      channelInstanceId: input.channelInstanceId, orderItems, operations,
    })) {
      throw new ShopifyOrderReviewRequiredError(
       'source_provenance_conflict', 'Existing fulfilled quantities lack exact storefront-scoped stock receipts; review their history before replay.',
      );
    }
  }
  const shipmentQuantities = buildShopifyShipmentQuantities({
    topic: input.topic,
    payloadLines: Array.isArray(input.payload.line_items)
      ? input.payload.line_items.map((line: unknown) => {
        if (!line || typeof line !== 'object') throw new Error('Shopify fulfilment line is invalid.');
        const value = line as Record<string, unknown>;
        return { id: String(value.id ?? value.line_item_id ?? ''), quantity: Number(value.quantity ?? 0) };
      })
      : [],
    orderItems,
  });
  const operationId = String(input.payload.id ?? externalOrderId);
  const fulfilmentInput = {
    businessId: input.businessId,
    soId: order.id,
    operationKey: `shopify:${input.channelInstanceId}:${input.topic}:${operationId}`,
    shipmentQuantities,
    allowIncomingCoveredStockShortfall: true,
    finalizeWhenComplete: true,
  };
  try {
    if (connection) await fulfilSalesOrderPartialInTransaction(connection, fulfilmentInput);
    else await fulfilSalesOrderPartial(fulfilmentInput);
  } catch (error) {
    if (connection && (error instanceof StockShortfallError
      || error instanceof ProtectedStockConflict || error instanceof SalesOrderPriorityConflict)) {
      throw new ShopifyOrderReviewRequiredError(
        'fulfilment_stock_conflict', 'Recovered shipment conflicts with available or protected stock; review its stock history before retrying.',
      );
    }
    throw error;
  }
  if (shipment) {
    await persist(shipment);
  }
  return { outcome: 'fulfilled', salesOrderId: order.id };
}