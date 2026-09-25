import { syncShopifyGiftCardSnapshots, type ShopifyGiftCardSyncResult } from '@/lib/ims/shopifyGiftCardSync';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { ShopifyService } from '@/services/ShopifyService';

export function hasShopifyGiftCardPayment(payload: unknown): boolean {
  const gateways = (payload as { payment_gateway_names?: unknown })?.payment_gateway_names;
  if (!Array.isArray(gateways)) return false;
  return gateways.some(gateway => String(gateway).trim().toLowerCase().replace(/[\s-]+/g, '_') === 'gift_card');
}

export async function reconcileGiftCardsFromPaidShopifyOrder(
  businessId: string,
  channelInstanceId: string,
  payload: unknown,
): Promise<ShopifyGiftCardSyncResult | null> {
  if (!hasShopifyGiftCardPayment(payload)) return null;

  const context = await getShopifyOperationContext({ businessId, channelInstanceId });
  if (shopifyInstanceSettings(context.instance.settings).giftCards.mode !== 'combined') return null;

  return syncShopifyGiftCardSnapshots(
    businessId,
    channelInstanceId,
    new ShopifyService(context.credentials.shopDomain, context.credentials.token),
  );
}