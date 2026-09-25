import { cookies } from 'next/headers';
import { LoyaltyPortalProfileRepository } from './LoyaltyPortalProfile';
import { LOYALTY_PORTAL_SESSION_COOKIE, verifyLoyaltyPortalSession } from './LoyaltyPortalSession';
import { resolveLoyaltyPortalShopifyInstance } from './loyaltyPortalShopifyInstance';

export async function getLoyaltyPortalAuth(slug: string) {
  const profile = await LoyaltyPortalProfileRepository.getActiveBySlug(slug);
  if (!profile) return null;
  const session = verifyLoyaltyPortalSession(cookies().get(LOYALTY_PORTAL_SESSION_COOKIE)?.value ?? '');
  if (!session || session.businessId !== profile.businessId || session.portalSlug !== profile.slug) return null;
  const channelInstanceId = await resolveLoyaltyPortalShopifyInstance({
    businessId: profile.businessId,
    shopifyReturnUrl: profile.shopifyReturnUrl,
    allowedChannelInstanceIds: [session.channelInstanceId],
  });
  if (channelInstanceId !== session.channelInstanceId) return null;
  return { profile, session };
}