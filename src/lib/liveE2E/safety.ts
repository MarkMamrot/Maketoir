export const LIVE_CONFIRMATION = 'MONSTERTHREADS_LIVE_E2E';

export type LiveE2EAction = 'preflight' | 'fifo-reconcile-negative' | 'fifo-activate' | 'p1' | 'p1-repair' | 'p1-compensate' | 'p2' | 'p2-compensate' | 'p3' | 'p3-compensate' | 'p4' | 'p4-compensate' | 'p5' | 'p5-compensate' | 'p6' | 'p6-compensate' | 'p7' | 'p7-compensate' | 'p8' | 'p8-compensate' | 'p9' | 'p9-compensate' | 'allocation' | 'allocation-compensate' | 'allocation-received' | 'allocation-received-compensate' | 'inspect' | 'acknowledge' | 'retry-compensation' | 'compensate' | 'verify-clean' | 'report';

export type LiveE2EConfig = {
  action: LiveE2EAction;
  baseUrl: string;
  expectedBusinessId: string;
  expectedImsSchema: string;
  expectedCostingMethod: 'average_cost' | 'fifo';
  expectedShopifyShop: string;
  expectedXeroTenantId: string;
  adminEmail: string;
  adminPassword: string;
  runId: string;
  fixtureVariantId: string;
  fixtureSku: string;
  fixtureLocationId: number;
  fixtureSupplierId: number;
  fixtureCustomerId: number;
  maxDocumentTotal: number;
};

const ALLOWED_ACTIONS = new Set<LiveE2EAction>(['preflight', 'fifo-reconcile-negative', 'fifo-activate', 'p1', 'p1-repair', 'p1-compensate', 'p2', 'p2-compensate', 'p3', 'p3-compensate', 'p4', 'p4-compensate', 'p5', 'p5-compensate', 'p6', 'p6-compensate', 'p7', 'p7-compensate', 'p8', 'p8-compensate', 'p9', 'p9-compensate', 'allocation', 'allocation-compensate', 'allocation-received', 'allocation-received-compensate', 'inspect', 'acknowledge', 'retry-compensation', 'compensate', 'verify-clean', 'report']);

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Live E2E blocked: ${key} is required.`);
  return value;
}

function positiveNumber(env: NodeJS.ProcessEnv, key: string): number {
  const value = Number(required(env, key));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Live E2E blocked: ${key} must be a positive number.`);
  return value;
}

export function loadLiveE2EConfig(env: NodeJS.ProcessEnv = process.env): LiveE2EConfig {
  if (env.CI) throw new Error('Live E2E blocked: CI execution is forbidden.');
  if (env.LIVE_E2E_CONFIRM !== LIVE_CONFIRMATION) {
    throw new Error(`Live E2E blocked: LIVE_E2E_CONFIRM must equal ${LIVE_CONFIRMATION}.`);
  }

  const action = required(env, 'LIVE_E2E_ACTION') as LiveE2EAction;
  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Live E2E blocked: unsupported action ${action}.`);

  const baseUrl = required(env, 'LIVE_E2E_BASE_URL');
  const parsedUrl = new URL(baseUrl);
  if (!['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
    throw new Error('Live E2E blocked: browser execution must use the local application server.');
  }

  const runId = required(env, 'LIVE_E2E_RUN_ID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/.test(runId)) {
    throw new Error('Live E2E blocked: LIVE_E2E_RUN_ID must be 6-64 safe filename characters.');
  }
  const maxDocumentTotal = positiveNumber(env, 'LIVE_E2E_MAX_DOCUMENT_TOTAL');
  if (maxDocumentTotal > 5) throw new Error('Live E2E blocked: document total cap cannot exceed AUD 5.00.');
  const expectedCostingMethod = required(env, 'LIVE_E2E_EXPECTED_COSTING_METHOD');
  if (expectedCostingMethod !== 'average_cost' && expectedCostingMethod !== 'fifo') {
    throw new Error('Live E2E blocked: LIVE_E2E_EXPECTED_COSTING_METHOD must be average_cost or fifo.');
  }

  return {
    action,
    baseUrl: parsedUrl.origin,
    expectedBusinessId: required(env, 'LIVE_E2E_EXPECTED_BUSINESS_ID'),
    expectedImsSchema: required(env, 'LIVE_E2E_EXPECTED_IMS_SCHEMA'),
    expectedCostingMethod,
    expectedShopifyShop: required(env, 'LIVE_E2E_EXPECTED_SHOPIFY_SHOP'),
    expectedXeroTenantId: required(env, 'LIVE_E2E_EXPECTED_XERO_TENANT_ID'),
    adminEmail: required(env, 'LIVE_E2E_ADMIN_EMAIL'),
    adminPassword: required(env, 'LIVE_E2E_ADMIN_PASSWORD'),
    runId,
    fixtureVariantId: required(env, 'LIVE_E2E_FIXTURE_VARIANT_ID'),
    fixtureSku: required(env, 'LIVE_E2E_FIXTURE_SKU'),
    fixtureLocationId: positiveNumber(env, 'LIVE_E2E_FIXTURE_LOCATION_ID'),
    fixtureSupplierId: positiveNumber(env, 'LIVE_E2E_FIXTURE_SUPPLIER_ID'),
    fixtureCustomerId: positiveNumber(env, 'LIVE_E2E_FIXTURE_CUSTOMER_ID'),
    maxDocumentTotal,
  };
}

export function assertPreflightIdentity(
  config: LiveE2EConfig,
  actual: { businessId?: string; tier?: string },
): void {
  if (config.action !== 'preflight') throw new Error('Live E2E blocked: login preflight requires action preflight.');
  if (actual.businessId !== config.expectedBusinessId) {
    throw new Error('Live E2E blocked: authenticated business does not match the expected business ID.');
  }
  if (actual.tier !== 'Admin' && actual.tier !== 'SuperAdmin') {
    throw new Error('Live E2E blocked: authenticated user must be an Admin or SuperAdmin.');
  }
}

const SECRET_KEY = /password|secret|token|cookie|authorization|pin/i;

export function assertLiveAllocationOrders(
  config: LiveE2EConfig,
  recorded: { purchaseOrderIds: readonly number[]; salesOrderIds: readonly number[]; receivedPurchaseOrderIds?: readonly number[] },
  open: { purchaseOrders: readonly Record<string, unknown>[]; salesOrders: readonly Record<string, unknown>[] },
): void {
  const receivedAction = ['allocation-received', 'allocation-received-compensate'].includes(config.action);
  const receivedIds = recorded.receivedPurchaseOrderIds ?? [];
  if (receivedIds.length > 1 || receivedIds.some(id => !Number.isInteger(id) || !recorded.purchaseOrderIds.includes(id))
    || (receivedIds.length > 0 && !receivedAction)) {
    throw new Error('Live E2E blocked: invalid recorded allocation receipt ownership.');
  }
  for (const group of [
    { ids: recorded.purchaseOrderIds, orders: open.purchaseOrders, sales: false },
    { ids: recorded.salesOrderIds, orders: open.salesOrders, sales: true },
  ]) {
    if (group.ids.length > 2 || new Set(group.ids).size !== group.ids.length
      || group.ids.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new Error('Live E2E blocked: invalid allocation campaign document IDs.');
    }
    for (const order of group.orders) {
      const ownedReceipt = !group.sales && receivedAction && receivedIds.includes(Number(order.id));
      const validReceipt = ownedReceipt && String(order.status) === 'complete'
        && String(order.variant_id) === config.fixtureVariantId
        && Number(order.qty_ordered) === 2 && Number(order.qty_received) === 2;
      const cancelledReceipt = ownedReceipt && config.action === 'allocation-received-compensate'
        && String(order.status) === 'cancelled' && Number(order.qty_received) === 0;
      if (!group.ids.includes(Number(order.id))
        || Number(order.location_id) !== config.fixtureLocationId
        || (order.variant_id != null && String(order.variant_id) !== config.fixtureVariantId)
        || !String(order.notes ?? '').startsWith(`LIVE E2E ${config.runId} ALLOCATION `)
        || (!['draft', 'confirmed'].includes(String(order.status)) && !validReceipt && !cancelledReceipt)
        || String(order.tax_treatment) !== 'no_tax'
        || !Number.isFinite(Number(order.total_amount))
        || Number(order.total_amount) <= 0 || Number(order.total_amount) > config.maxDocumentTotal
        || (group.sales ? Number(order.customer_id) !== config.fixtureCustomerId || Number(order.qty_fulfilled) !== 0
          : Number(order.supplier_id) !== config.fixtureSupplierId || (Number(order.qty_received) !== 0 && !validReceipt))) {
        throw new Error('Live E2E blocked: allocation campaign contains unexpected open work.');
      }
    }
  }
}

export function assertLiveShopifyOwnership(
  config: Pick<LiveE2EConfig, 'expectedBusinessId' | 'expectedShopifyShop'>,
  legacyShop: unknown,
  instances: readonly {
    business_id: string;
    provider: string;
    external_account_key: string | null;
    is_enabled: number;
    runtime_status: string;
    readiness_status: string;
  }[],
): void {
  const expectedShop = config.expectedShopifyShop.trim().toLowerCase();
  if (String(legacyShop ?? '').trim().toLowerCase() !== expectedShop) {
    throw new Error('Live E2E blocked: legacy Shopify identity does not match the expected test store.');
  }
  const matching = instances.filter(instance => instance.provider === 'shopify'
    && instance.external_account_key?.trim().toLowerCase() === expectedShop);
  if (matching.length !== 1 || matching[0].business_id !== config.expectedBusinessId) {
    throw new Error('Live E2E blocked: the expected Shopify test store must have exactly one canonical owner in the expected sandbox.');
  }
  const instance = matching[0];
  if (Number(instance.is_enabled) !== 1 || instance.runtime_status !== 'active' || instance.readiness_status !== 'ready') {
    throw new Error('Live E2E blocked: the expected Shopify test channel must be enabled, active and ready.');
  }
}

export function redactLiveE2EValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactLiveE2EValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactLiveE2EValue(childValue, childKey),
    ]));
  }
  return value;
}