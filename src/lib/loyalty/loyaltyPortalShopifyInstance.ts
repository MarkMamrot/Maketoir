import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';

export async function resolveLoyaltyPortalShopifyInstance(input: {
  businessId: string;
  shopifyReturnUrl: string;
  allowedChannelInstanceIds?: string[];
}): Promise<string | null> {
  let host = '';
  try {
    host = new URL(input.shopifyReturnUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const allowed = input.allowedChannelInstanceIds ? new Set(input.allowedChannelInstanceIds) : null;
  const matches = (await SalesChannelInstanceRepository.listForBusiness(input.businessId)).filter(instance =>
    instance.provider === 'shopify'
    && instance.enabled
    && instance.runtimeStatus === 'active'
    && instance.readinessStatus === 'ready'
    && String(instance.externalAccountKey ?? '').toLowerCase() === host
    && (!allowed || allowed.has(instance.channelInstanceId)),
  );
  return matches.length === 1 ? matches[0].channelInstanceId : null;
}