import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import type { SalesChannelInstance } from '@/lib/channels/types';
import { assertShopifyEnabled } from '@/lib/ims/businessOperations';
import {
  getShopifyChannelAdminCredentials,
  type ShopifyAdminCredentials,
} from '@/lib/shopifyCredentials';

export type ShopifyOperationContext = {
  businessId: string;
  channelInstanceId: string;
  instance: SalesChannelInstance;
  credentials: ShopifyAdminCredentials;
};

export class ShopifyOperationContextError extends Error {
  constructor(
    readonly code: 'invalid_context' | 'instance_not_found' | 'instance_inactive' | 'instance_not_ready' | 'credentials_missing',
    message: string,
  ) {
    super(message);
    this.name = 'ShopifyOperationContextError';
  }
}

export async function getShopifyOperationContext(input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<ShopifyOperationContext> {
  const businessId = input.businessId.trim();
  const channelInstanceId = input.channelInstanceId.trim();
  if (!businessId || !channelInstanceId) {
    throw new ShopifyOperationContextError('invalid_context', 'Business and Shopify channel instance are required.');
  }

  await assertShopifyEnabled(businessId);
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance || instance.provider !== 'shopify') {
    throw new ShopifyOperationContextError('instance_not_found', 'Shopify channel instance was not found.');
  }
  if (!instance.enabled || instance.runtimeStatus !== 'active') {
    throw new ShopifyOperationContextError('instance_inactive', 'Shopify channel instance is not active.');
  }
  if (instance.readinessStatus !== 'ready') {
    throw new ShopifyOperationContextError('instance_not_ready', 'Shopify channel instance is not ready.');
  }

  const credentials = await getShopifyChannelAdminCredentials(businessId, channelInstanceId);
  if (!credentials) {
    throw new ShopifyOperationContextError('credentials_missing', 'Shopify channel credentials are not configured.');
  }
  return { businessId, channelInstanceId, instance, credentials };
}