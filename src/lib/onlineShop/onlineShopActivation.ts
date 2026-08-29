import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { OnlineSalesChannelRepository, OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import type { OnlineSalesChannel } from '@/lib/storefront/channel';
import { query } from '@/services/MySQLService';
import { imsQuery } from '@/services/IMSMySQLService';

export interface OnlineShopReadinessItem { id: string; label: string; ready: boolean }
export interface OnlineShopActivationState { activeChannel: OnlineSalesChannel; isActive: boolean; ready: boolean; items: OnlineShopReadinessItem[] }

export async function getOnlineShopActivationState(businessId: string): Promise<OnlineShopActivationState> {
  const [profile, capabilities, layoutRows, stripe] = await Promise.all([
    OnlineShopProfileRepository.getByBusinessId(businessId), OnlineSalesChannelRepository.getCapabilities(businessId),
    query<{ published_revision: number }>('SELECT published_revision FROM online_shop_layouts WHERE business_id = ? LIMIT 1', [businessId]),
    OnlineShopStripeConnectionRepository.get(businessId),
  ]);
  const tenant = await runImsForBusiness(businessId, async () => {
    const [products, locations, shipping, pickups] = await Promise.all([
      imsQuery<{ count: number }>('SELECT COUNT(*) AS count FROM ims_online_shop_products WHERE business_id = ? AND is_published = 1', [businessId]),
      imsQuery<{ count: number }>('SELECT COUNT(*) AS count FROM ims_locations WHERE business_id = ? AND is_active = 1 AND has_online = 1', [businessId]),
      imsQuery<{ count: number }>('SELECT COUNT(*) AS count FROM ims_online_shop_shipping_rules WHERE business_id = ? AND is_active = 1', [businessId]),
      imsQuery<{ count: number }>('SELECT COUNT(*) AS count FROM ims_online_shop_pickup_locations WHERE business_id = ? AND is_active = 1', [businessId]),
    ]);
    return { products: Number(products[0]?.count) || 0, locations: Number(locations[0]?.count) || 0,
      shipping: Number(shipping[0]?.count) || 0, pickups: Number(pickups[0]?.count) || 0 };
  });
  const items: OnlineShopReadinessItem[] = [
    { id: 'profile', label: 'Store profile saved', ready: Boolean(profile) },
    { id: 'layout', label: 'Store templates published', ready: Number(layoutRows[0]?.published_revision) > 0 },
    { id: 'products', label: 'At least one product published', ready: tenant.products > 0 },
    { id: 'locations', label: 'At least one online stock location active', ready: tenant.locations > 0 },
    { id: 'shipping', label: 'Delivery or click-and-collect configured', ready: tenant.shipping > 0 || tenant.pickups > 0 },
    { id: 'stripe', label: 'Stripe connected and charges enabled', ready: Boolean(stripe?.chargesEnabled && stripe.detailsSubmitted && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) },
    { id: 'webhook', label: 'Stripe Connect webhook configured', ready: Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET) },
  ];
  const activeChannel: OnlineSalesChannel = capabilities.nativeShopEnabled ? 'native_shop'
    : capabilities.shopifyEnabled ? 'shopify' : 'none';
  return { activeChannel, isActive: profile?.isActive === true && capabilities.nativeShopEnabled, ready: items.every(item => item.ready), items };
}

export async function setOnlineShopActivation(input: { businessId: string; active: boolean; actorUserId?: number; actorName?: string }): Promise<OnlineShopActivationState> {
  if (input.active) {
    const state = await getOnlineShopActivationState(input.businessId);
    if (!state.ready) throw new Error('Complete every online shop readiness item before activation.');
    await OnlineShopProfileRepository.setActive(input.businessId, true);
  } else {
    await OnlineShopProfileRepository.setActive(input.businessId, false);
  }
  return getOnlineShopActivationState(input.businessId);
}