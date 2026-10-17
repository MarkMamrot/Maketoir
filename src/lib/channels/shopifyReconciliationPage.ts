import {
  ONLINE_SYNC_LIMITS, OnlineSyncValidationError, onlineSyncPageInfo, onlineSyncTimestamp,
  validateReconciliationWindow,
  type OrderReference, type ReconciliationWindow,
} from './onlineSyncPolicy';

export function shopifyReconciliationParameters(
  window: ReconciliationWindow,
  pageInfo: string | null,
): Record<string, string | number> {
  const normalized = validateReconciliationWindow(window);
  if (pageInfo !== null) {
    onlineSyncPageInfo(pageInfo);
    return { limit: ONLINE_SYNC_LIMITS.pageSize, page_info: pageInfo, fields: 'id,created_at,updated_at' };
  }
  return {
    limit: ONLINE_SYNC_LIMITS.pageSize,
    status: 'any',
    fields: 'id,created_at,updated_at',
    updated_at_min: normalized.from, updated_at_max: normalized.to,
  };
}

export function shopifyReconciliationPage(value: unknown): { orders: OrderReference[]; nextPageInfo: string | null } {
  if (!Array.isArray(value) || value.length > ONLINE_SYNC_LIMITS.pageSize) {
    throw new OnlineSyncValidationError('Invalid Shopify reconciliation page.');
  }
  const orders = value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('id' in raw) || !('updated_at' in raw) || !('created_at' in raw)) {
      throw new OnlineSyncValidationError('Incomplete Shopify reconciliation order reference.');
    }
    if ((typeof raw.id !== 'string' && typeof raw.id !== 'number')
      || (typeof raw.id === 'number' && !Number.isSafeInteger(raw.id))
      || !/^[1-9]\d*$/.test(String(raw.id)) || typeof raw.updated_at !== 'string' || typeof raw.created_at !== 'string') {
      throw new OnlineSyncValidationError('Invalid Shopify reconciliation order identity.');
    }
    onlineSyncTimestamp(raw.created_at);
    return { id: String(raw.id), updatedAt: new Date(onlineSyncTimestamp(raw.updated_at)).toISOString() };
  });
  if (new Set(orders.map(order => order.id)).size !== orders.length) {
    throw new OnlineSyncValidationError('Duplicate Shopify reconciliation order references.');
  }
  let nextPageInfo: string | null = null;
  if ('nextPageParameters' in value && value.nextPageParameters !== undefined) {
    const parameters = value.nextPageParameters;
    if (!parameters || typeof parameters !== 'object' || !('page_info' in parameters) || typeof parameters.page_info !== 'string') {
      throw new OnlineSyncValidationError('Missing Shopify continuation token.');
    }
    nextPageInfo = onlineSyncPageInfo(parameters.page_info);
  }
  return { orders, nextPageInfo };
}

export function assertShopifyReconciliationHistoryAccess(input: {
  baselineFrom: string;
  now: string;
  scopes: string[];
}): void {
  const from = onlineSyncTimestamp(input.baselineFrom);
  const now = onlineSyncTimestamp(input.now);
  if (!input.scopes.some(scope => scope === 'read_orders' || scope === 'write_orders')) {
    throw new OnlineSyncValidationError('Shopify order read access is required for reconciliation.');
  }
  if (now - from > 60 * 24 * 60 * 60_000 && !input.scopes.includes('read_all_orders')) {
    throw new OnlineSyncValidationError('Shopify read_all_orders access is required for the configured order history.');
  }
}
