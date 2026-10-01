import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { applyShopifyOrderFulfilment } from '@/lib/channels/shopifyOrderFulfilment';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService, type ShopifyUpdatedOrder } from '@/services/ShopifyService';

export type ShopifyFulfilmentReconciliationResult = {
  channelInstanceId: string;
  windowStart: string;
  windowEnd: string;
  disabled: boolean;
  scanned: number;
  providerFulfilled: number;
  repaired: Array<{ salesOrderId: number; shopifyOrderId: string }>;
  alreadyCurrent: number;
  missingLocal: string[];
  reviewRequired: Array<{ salesOrderId: number; shopifyOrderId: string; status: string }>;
  invalidProviderRows: number;
  failures: Array<{ shopifyOrderId: string; salesOrderId?: number; error: string }>;
};

function validDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp.`);
  return date;
}

function providerOrderId(order: ShopifyUpdatedOrder): string | null {
  const id = String(order.id ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}

export async function reconcileShopifyFulfilmentsForChannel(input: {
  businessId: string;
  channelInstanceId: string;
  windowStart: string;
  windowEnd: string;
}): Promise<ShopifyFulfilmentReconciliationResult> {
  const windowStart = validDate(input.windowStart, 'Reconciliation window start');
  const windowEnd = validDate(input.windowEnd, 'Reconciliation window end');
  if (windowStart.getTime() >= windowEnd.getTime()) throw new Error('Reconciliation window start must precede its end.');

  const result: ShopifyFulfilmentReconciliationResult = {
    channelInstanceId: input.channelInstanceId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    disabled: false,
    scanned: 0,
    providerFulfilled: 0,
    repaired: [],
    alreadyCurrent: 0,
    missingLocal: [],
    reviewRequired: [],
    invalidProviderRows: 0,
    failures: [],
  };
  const context = await getShopifyOperationContext({
    businessId: input.businessId,
    channelInstanceId: input.channelInstanceId,
  });
  const settings = shopifyInstanceSettings(context.instance.settings);
  if (!settings.orders.enabled) {
    result.disabled = true;
    return result;
  }

  const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
  const providerOrders = await shopify.getOrdersUpdatedSince(result.windowStart);
  result.scanned = providerOrders.length;
  const seen = new Set<string>();
  for (const order of providerOrders) {
    const shopifyOrderId = providerOrderId(order);
    const updatedAt = new Date(String(order.updated_at ?? ''));
    const createdDate = String(order.created_at ?? '').slice(0, 10);
    if (!shopifyOrderId || Number.isNaN(updatedAt.getTime())
      || (settings.orders.syncFrom && !/^\d{4}-\d{2}-\d{2}$/.test(createdDate))) {
      result.invalidProviderRows += 1;
      continue;
    }
    if (seen.has(shopifyOrderId)
      || updatedAt.getTime() < windowStart.getTime()
      || updatedAt.getTime() > windowEnd.getTime()) continue;
    seen.add(shopifyOrderId);
    if (String(order.fulfillment_status ?? '').toLowerCase() !== 'fulfilled') continue;
    if (settings.orders.syncFrom && createdDate && createdDate < settings.orders.syncFrom) continue;
    result.providerFulfilled += 1;

    const localOrders = await imsQuery<{ id: number; status: string }>(
      `SELECT id, status
         FROM ims_sales_orders
        WHERE business_id = ? AND sales_channel = 'shopify'
          AND channel_instance_id = ? AND external_order_id = ?
        LIMIT 1`,
      [input.businessId, input.channelInstanceId, shopifyOrderId],
    );
    const localOrder = localOrders[0];
    if (!localOrder) {
      result.missingLocal.push(shopifyOrderId);
      continue;
    }
    if (localOrder.status === 'fulfilled') {
      result.alreadyCurrent += 1;
      continue;
    }
    if (!['confirmed', 'partially_fulfilled'].includes(localOrder.status)) {
      result.reviewRequired.push({
        salesOrderId: Number(localOrder.id), shopifyOrderId, status: String(localOrder.status),
      });
      continue;
    }
    try {
      const repaired = await applyShopifyOrderFulfilment({
        businessId: input.businessId,
        channelInstanceId: input.channelInstanceId,
        topic: 'orders/fulfilled',
        payload: { id: shopifyOrderId },
      });
      if (repaired.outcome === 'already_fulfilled') result.alreadyCurrent += 1;
      else result.repaired.push({ salesOrderId: repaired.salesOrderId, shopifyOrderId });
    } catch (error) {
      result.failures.push({
        shopifyOrderId,
        salesOrderId: Number(localOrder.id),
        error: error instanceof Error ? error.message : 'Shopify fulfilment reconciliation failed.',
      });
    }
  }
  return result;
}