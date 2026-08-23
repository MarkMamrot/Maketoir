export const ONLINE_SALES_CHANNELS = ['none', 'shopify', 'native_shop'] as const;
export type OnlineSalesChannel = typeof ONLINE_SALES_CHANNELS[number];

export function isOnlineSalesChannel(value: unknown): value is OnlineSalesChannel {
  return typeof value === 'string' && ONLINE_SALES_CHANNELS.includes(value as OnlineSalesChannel);
}

export function parseOnlineSalesChannel(value: unknown): OnlineSalesChannel {
  return isOnlineSalesChannel(value) ? value : 'none';
}

export interface StorefrontContext {
  channel: Exclude<OnlineSalesChannel, 'none'>;
  businessId: string;
  slug: string;
  basePath: string;
  canonicalOrigin?: string;
}