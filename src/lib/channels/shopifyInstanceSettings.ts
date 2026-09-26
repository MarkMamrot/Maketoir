export type ShopifyGiftCardMode = 'off' | 'combined';

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
    payoutPostingEnabled: boolean;
    payoutAutoPostEnabled: boolean;
  };
};

export type ShopifyInstanceSettingsPatch = {
  orders?: Partial<ShopifyInstanceSettings['orders']>;
  inventory?: Partial<ShopifyInstanceSettings['inventory']>;
  customers?: Partial<ShopifyInstanceSettings['customers']>;
  giftCards?: Partial<ShopifyInstanceSettings['giftCards']>;
  xero?: Partial<ShopifyInstanceSettings['xero']>;
};

export class ShopifyInstanceSettingsValidationError extends Error {}

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
      payoutPostingEnabled: enabled(xero.payoutPostingEnabled),
      payoutAutoPostEnabled: enabled(xero.payoutAutoPostEnabled),
    },
  };
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new ShopifyInstanceSettingsValidationError(`${label} must be true or false.`);
}

function assertNullablePositiveInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (!Number.isInteger(value) || Number(value) <= 0)) {
    throw new ShopifyInstanceSettingsValidationError(`${label} must be a positive whole number or empty.`);
  }
}

export function mergeShopifyInstanceSettings(
  currentSettings: Record<string, unknown>,
  patch: ShopifyInstanceSettingsPatch,
): ShopifyInstanceSettings {
  const current = shopifyInstanceSettings(currentSettings);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ShopifyInstanceSettingsValidationError('Shopify settings must be an object.');
  }

  const orders = patch.orders ?? {};
  if (orders.enabled !== undefined) assertBoolean(orders.enabled, 'Order sync enabled');
  if (orders.syncFrom !== undefined && orders.syncFrom !== null
    && (typeof orders.syncFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(orders.syncFrom))) {
    throw new ShopifyInstanceSettingsValidationError('Order sync start date must use YYYY-MM-DD or be empty.');
  }
  if (orders.locationId !== undefined) assertNullablePositiveInteger(orders.locationId, 'Order location');

  const inventory = patch.inventory ?? {};
  if (inventory.enabled !== undefined) assertBoolean(inventory.enabled, 'Inventory sync enabled');
  if (inventory.buffer !== undefined && (!Number.isInteger(inventory.buffer) || Number(inventory.buffer) < 0)) {
    throw new ShopifyInstanceSettingsValidationError('Inventory buffer must be a non-negative whole number.');
  }
  if (inventory.intervalMinutes !== undefined
    && (!Number.isInteger(inventory.intervalMinutes) || Number(inventory.intervalMinutes) <= 0)) {
    throw new ShopifyInstanceSettingsValidationError('Inventory interval must be a positive whole number.');
  }
  if (inventory.locationId !== undefined) assertNullablePositiveInteger(inventory.locationId, 'Inventory location');
  if (inventory.pickLocationIds !== undefined
    && (!Array.isArray(inventory.pickLocationIds)
      || inventory.pickLocationIds.some(id => !Number.isInteger(id) || Number(id) <= 0))) {
    throw new ShopifyInstanceSettingsValidationError('Inventory source locations must contain positive whole numbers.');
  }

  const customers = patch.customers ?? {};
  if (customers.outboundEnabled !== undefined) assertBoolean(customers.outboundEnabled, 'Outbound customer sync enabled');

  const giftCards = patch.giftCards ?? {};
  if (giftCards.mode !== undefined && giftCards.mode !== 'off' && giftCards.mode !== 'combined') {
    throw new ShopifyInstanceSettingsValidationError('Gift-card mode must be off or combined.');
  }

  const xero = patch.xero ?? {};
  if (xero.dailyAutoSyncEnabled !== undefined) assertBoolean(xero.dailyAutoSyncEnabled, 'Daily Xero sync enabled');
  if (xero.payoutPostingEnabled !== undefined) assertBoolean(xero.payoutPostingEnabled, 'Payout posting enabled');
  if (xero.payoutAutoPostEnabled !== undefined) assertBoolean(xero.payoutAutoPostEnabled, 'Payout auto-post enabled');

  const merged = shopifyInstanceSettings({
    shopify: {
      ...current,
      orders: { ...current.orders, ...orders },
      inventory: { ...current.inventory, ...inventory },
      customers: { ...current.customers, ...customers },
      giftCards: { ...current.giftCards, ...giftCards },
      xero: { ...current.xero, ...xero },
    },
  });
  if (merged.orders.enabled && (!merged.orders.syncFrom || !merged.orders.locationId)) {
    throw new ShopifyInstanceSettingsValidationError('Enabled order sync requires a start date and online orders location.');
  }
  if (merged.xero.payoutAutoPostEnabled && !merged.xero.payoutPostingEnabled) {
    throw new ShopifyInstanceSettingsValidationError('Automatic payout posting requires payout posting to be enabled.');
  }
  return merged;
}