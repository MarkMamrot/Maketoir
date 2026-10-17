import { applyShopifyPaidOrderLoyalty } from './shopifyPaidOrderLoyalty';
import { applyShopifyOrderFulfilment } from './shopifyOrderFulfilment';
import { cancelShopifyOrder, importShopifyOrder } from './shopifyOrderImport';
import { applyShopifyOrderRefund } from './shopifyOrderRefund';
import { updateShopifyOrder } from './shopifyOrderUpdate';
import { reconcileGiftCardsFromPaidShopifyOrder } from '@/lib/ims/shopifyGiftCardWebhook';
import { getOnlineSyncControl } from './onlineSyncControl';
import { queueShopifyRecoveryEvent } from './shopifyOrderRecovery';

export type ShopifyOrderEventResult =
  | { eventStatus: 'ignored' }
  | { eventStatus: 'complete'; outcome: string; salesOrderId: number | null; creditNoteId?: number | null };

// Authentication, tenant binding, eligibility and delivery claims belong to the caller.
export async function processShopifyOrderEvent(input: {
  businessId: string;
  channelInstanceId: string;
  locationId: number | null;
  topic: string;
  payload: Record<string, unknown>;
  eventId?: string;
}): Promise<ShopifyOrderEventResult> {
  if ((await getOnlineSyncControl(input.businessId)).mode !== 'legacy') {
    return queueShopifyRecoveryEvent(input);
  }
  const owner = { businessId: input.businessId, channelInstanceId: input.channelInstanceId };
  const payload = input.payload;
  if (input.topic === 'orders/cancelled') {
    const result = await cancelShopifyOrder({ ...owner, order: payload });
    return { eventStatus: 'complete', ...result };
  }
  if (input.topic === 'fulfillments/create' || input.topic === 'fulfillments/update'
    || input.topic === 'orders/fulfilled') {
    const result = await applyShopifyOrderFulfilment({ ...owner, topic: input.topic, payload });
    return { eventStatus: 'complete', ...result };
  }
  if (input.topic === 'refunds/create') {
    const result = await applyShopifyOrderRefund({ ...owner, refund: payload });
    return { eventStatus: 'complete', ...result };
  }
  if (input.topic === 'orders/updated') {
    const updated = await updateShopifyOrder({ ...owner, order: payload });
    if (String(payload.fulfillment_status ?? '').toLowerCase() === 'fulfilled') {
      const result = await applyShopifyOrderFulfilment({ ...owner, topic: 'orders/fulfilled', payload });
      return { eventStatus: 'complete', ...result };
    }
    return { eventStatus: 'complete', ...updated };
  }
  if (input.topic !== 'orders/create' && input.topic !== 'orders/paid') {
    throw new Error('Unsupported Shopify order-processing topic.');
  }
  if (!input.locationId) return { eventStatus: 'ignored' };
  const imported = await importShopifyOrder({
    ...owner, locationId: input.locationId, topic: input.topic, order: payload,
  });
  if (input.topic === 'orders/paid' && imported.salesOrderId) {
    await applyShopifyPaidOrderLoyalty({ ...owner, order: payload });
    await reconcileGiftCardsFromPaidShopifyOrder(input.businessId, input.channelInstanceId, payload);
  }
  return { eventStatus: 'complete', ...imported };
}
