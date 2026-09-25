import { syncShopifyGiftCardSnapshots, type ShopifyGiftCardSyncResult } from '@/lib/ims/shopifyGiftCardSync';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { ShopifyService } from '@/services/ShopifyService';

export async function reconcileLegacyGiftCardsFromPaidShopifyOrder(
  businessId: string,
  payload: unknown,
): Promise<ShopifyGiftCardSyncResult | null> {
  const gateways = (payload as { payment_gateway_names?: unknown })?.payment_gateway_names;
  if (!Array.isArray(gateways) || !gateways.some(gateway => (
    String(gateway).trim().toLowerCase().replace(/[\s-]+/g, '_') === 'gift_card'
  ))) return null;

  const instances = (await SalesChannelInstanceRepository.listForBusiness(businessId))
    .filter(instance => instance.provider === 'shopify'
      && instance.enabled
      && instance.runtimeStatus === 'active'
      && instance.readinessStatus === 'ready'
      && shopifyInstanceSettings(instance.settings).giftCards.mode === 'combined');
  if (!instances.length) return null;
  if (instances.length > 1) {
    throw new Error('Legacy Shopify gift-card reconciliation is ambiguous across multiple active stores; use the exact-instance webhook.');
  }
  const channelInstanceId = instances[0].channelInstanceId;
  const context = await getShopifyOperationContext({ businessId, channelInstanceId });

  return syncShopifyGiftCardSnapshots(
    businessId,
    channelInstanceId,
    new ShopifyService(context.credentials.shopDomain, context.credentials.token),
  );
}