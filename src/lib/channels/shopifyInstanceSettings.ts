export type ShopifyGiftCardMode = 'off' | 'combined';
export type ShopifyOnlineBatchAction = 'none' | 'draft' | 'authorised';

export type ShopifyInstanceSettings = {
  orders: {
    enabled: boolean;
    syncFrom: string | null;
    lastUpdatedAt: string | null;
    locationId: number | null;
  };
  inventory: {
    enabled: boolean;
    buffer: number;
    intervalMinutes: number;
    locationId: number | null;
    pickLocationIds: number[];
    lastRunAt: string | null;
  };
  customers: {
    outboundEnabled: boolean;
  };
  giftCards: {
    mode: ShopifyGiftCardMode;
  };
  xero: {
    dailyAutoSyncEnabled: boolean;
    onlineBatchAction: ShopifyOnlineBatchAction;
    paymentSyncEnabled: boolean;
    payoutPostingEnabled: boolean;
    payoutAutoPostEnabled: boolean;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveIntegerList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(positiveInteger).filter((item): item is number => item !== null))];
}

export function shopifyInstanceSettings(settings: Record<string, unknown>): ShopifyInstanceSettings {
  const shopify = record(settings.shopify);
  const orders = record(shopify.orders);
  const inventory = record(shopify.inventory);
  const customers = record(shopify.customers);
  const giftCards = record(shopify.giftCards);
  const xero = record(shopify.xero);
  const giftCardMode = giftCards.mode === 'combined' ? 'combined' : 'off';
  const onlineBatchAction = xero.onlineBatchAction === 'draft' || xero.onlineBatchAction === 'authorised'
    ? xero.onlineBatchAction
    : 'none';

  return {
    orders: {
      enabled: enabled(orders.enabled),
      syncFrom: nullableString(orders.syncFrom),
      lastUpdatedAt: nullableString(orders.lastUpdatedAt),
      locationId: positiveInteger(orders.locationId),
    },
    inventory: {
      enabled: enabled(inventory.enabled),
      buffer: nonNegativeInteger(inventory.buffer, 0),
      intervalMinutes: positiveInteger(inventory.intervalMinutes) ?? 15,
      locationId: positiveInteger(inventory.locationId),
      pickLocationIds: positiveIntegerList(inventory.pickLocationIds),
      lastRunAt: nullableString(inventory.lastRunAt),
    },
    customers: {
      outboundEnabled: enabled(customers.outboundEnabled),
    },
    giftCards: {
      mode: giftCardMode,
    },
    xero: {
      dailyAutoSyncEnabled: enabled(xero.dailyAutoSyncEnabled),
      onlineBatchAction,
      paymentSyncEnabled: enabled(xero.paymentSyncEnabled),
      payoutPostingEnabled: enabled(xero.payoutPostingEnabled),
      payoutAutoPostEnabled: enabled(xero.payoutAutoPostEnabled),
    },
  };
}