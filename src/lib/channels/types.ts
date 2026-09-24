export const SALES_CHANNEL_PROVIDERS = ['shopify', 'native_shop', 'amazon'] as const;

export type SalesChannelProvider = typeof SALES_CHANNEL_PROVIDERS[number];

export const SALES_CHANNEL_RUNTIME_STATUSES = ['draft', 'active', 'paused', 'error'] as const;
export type SalesChannelRuntimeStatus = typeof SALES_CHANNEL_RUNTIME_STATUSES[number];

export const SALES_CHANNEL_READINESS_STATUSES = ['not_tested', 'ready', 'error'] as const;
export type SalesChannelReadinessStatus = typeof SALES_CHANNEL_READINESS_STATUSES[number];

export const CHANNEL_PRODUCT_ASSIGNMENT_MODES = ['manual', 'add_matches', 'full_sync'] as const;
export type ChannelProductAssignmentMode = typeof CHANNEL_PRODUCT_ASSIGNMENT_MODES[number];

export function channelProductAssignmentMode(settings: Record<string, unknown>): ChannelProductAssignmentMode {
  const value = settings.productAssignmentMode;
  return typeof value === 'string' && CHANNEL_PRODUCT_ASSIGNMENT_MODES.includes(value as ChannelProductAssignmentMode)
    ? value as ChannelProductAssignmentMode
    : 'manual';
}

export interface SalesChannelInstance {
  channelInstanceId: string;
  businessId: string;
  provider: SalesChannelProvider;
  displayName: string;
  externalAccountKey: string | null;
  enabled: boolean;
  runtimeStatus: SalesChannelRuntimeStatus;
  readinessStatus: SalesChannelReadinessStatus;
  settings: Record<string, unknown>;
  lastSyncAt: string | null;
  safeError: string | null;
}

export interface SalesChannelCapabilities {
  catalogue: boolean;
  inventory: boolean;
  orders: boolean;
  fulfilments: boolean;
  returns: boolean;
  customers: boolean;
  giftCards: boolean;
  loyalty: boolean;
  settlements: boolean;
}

export interface SalesChannelAdapter {
  readonly provider: SalesChannelProvider;
  readonly displayName: string;
  readonly capabilities: Readonly<SalesChannelCapabilities>;
}

export function isSalesChannelProvider(value: unknown): value is SalesChannelProvider {
  return typeof value === 'string' && SALES_CHANNEL_PROVIDERS.includes(value as SalesChannelProvider);
}

export function isSalesChannelRuntimeStatus(value: unknown): value is SalesChannelRuntimeStatus {
  return typeof value === 'string' && SALES_CHANNEL_RUNTIME_STATUSES.includes(value as SalesChannelRuntimeStatus);
}

export function isSalesChannelReadinessStatus(value: unknown): value is SalesChannelReadinessStatus {
  return typeof value === 'string' && SALES_CHANNEL_READINESS_STATUSES.includes(value as SalesChannelReadinessStatus);
}

