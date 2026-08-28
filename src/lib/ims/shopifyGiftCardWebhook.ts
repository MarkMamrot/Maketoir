import { syncShopifyGiftCardSnapshots, type ShopifyGiftCardSyncResult } from '@/lib/ims/shopifyGiftCardSync';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export function hasShopifyGiftCardPayment(payload: unknown): boolean {
  const gateways = (payload as { payment_gateway_names?: unknown })?.payment_gateway_names;
  if (!Array.isArray(gateways)) return false;
  return gateways.some(gateway => String(gateway).trim().toLowerCase().replace(/[\s-]+/g, '_') === 'gift_card');
}

export async function reconcileGiftCardsFromPaidShopifyOrder(
  businessId: string,
  payload: unknown,
): Promise<ShopifyGiftCardSyncResult | null> {
  if (!hasShopifyGiftCardPayment(payload)) return null;

  const settingRows = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE `key` = 'shopify_gc_mode' LIMIT 1",
  );
  if (settingRows[0]?.value !== 'combined') return null;

  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) return null;

  return syncShopifyGiftCardSnapshots(
    businessId,
    new ShopifyService(credentials.shopDomain, credentials.token),
  );
}