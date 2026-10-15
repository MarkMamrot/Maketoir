import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), disabled: vi.fn(), query: vi.fn(), execute: vi.fn(), context: vi.fn(),
  locations: vi.fn(), levels: vi.fn(), report: vi.fn(), create: vi.fn(), apply: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: mocks.disabled }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {
  listLocations = mocks.locations;
  getInventoryLevels = mocks.levels;
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsStocktakeRepo: { create: mocks.create }, ImsShopifyRepo: { logAction: vi.fn() },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/inventoryDocumentLifecycle', () => ({ hashInventoryDocumentRequest: vi.fn().mockResolvedValue('hash') }));
vi.mock('@/lib/ims/stocktakes/stocktakeOperations', () => ({ applyStocktake: mocks.apply, transitionStocktake: vi.fn() }));

import { POST } from '../route';
import { signOpeningStockSnapshot } from '@/lib/ims/shopifyOpeningStockSnapshot';

function request(body: object) {
  return new Request('http://localhost/api/ims/shopify/opening-stock', {
    method: 'POST', body: JSON.stringify({ channelInstanceId: 'store-1', ...body }),
  });
}
function snapshot() {
  return signOpeningStockSnapshot({
    version: 2, businessId: 'biz-1', channelInstanceId: 'store-1', offset: 0, expiresAt: Date.now() + 60_000,
    lines: [{ variantId: 'v1', inventoryItemId: '100', locationName: 'Retail', solvantisLocationId: 1, quantity: 8, wasNegative: false }],
  });
}

describe('Shopify mapped onboarding inventory', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENCRYPTION_KEY', 'test-signing-key');
    mocks.session.mockResolvedValue({ businessId: 'biz-1', userId: 'user-1' });
    mocks.disabled.mockResolvedValue(null);
    mocks.context.mockResolvedValue({ credentials: { shopDomain: 'store.myshopify.com', token: 'secret' } });
    mocks.locations.mockResolvedValue([{ id: 10, name: 'Main Store', active: true }]);
    mocks.report.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(123);
    mocks.apply.mockResolvedValue({ applied: 1, variances: 1, replayed: false });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_locations')) return [{ id: 1, name: 'Retail', is_active: 1 }];
      if (sql.includes('FROM ims_product_variants')) return [{ variant_id: 'v1', shopify_inventory_item_id: '100', external_inventory_id: '100', sku: 'SKU', product_name: 'Item' }];
      return [];
    });
    mocks.levels.mockResolvedValue([{ inventoryItemId: '100', locationId: '10', available: 8 }]);
  });

  it('loads locations without changing stock', async () => {
    const response = await POST(request({ mode: 'locations' }));
    expect(await response.json()).toMatchObject({ success: true, shopifyLocations: [{ id: 10 }], solvantisLocations: [{ id: 1 }] });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('previews only canonical exact-store mappings and arbitrary chosen destinations', async () => {
    const response = await POST(request({ mode: 'preview', mappings: [{ shopifyLocationId: 10, solvantisLocationId: 1 }] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped_levels: 0, lines: [{ locationName: 'Retail', quantity: 8, adjustment: 8 }], apply_batches: [{ variant_ids: ['v1'] }] });
    const query = mocks.query.mock.calls.find(([sql]) => sql.includes('mapping.channel_instance_id'));
    expect(query?.[1]).toEqual(['biz-1', 'store-1']);
    expect(query?.[0]).toContain('COALESCE(p.is_stock_item, 1) = 1');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports missing levels and never creates zero-target apply batches for them', async () => {
    mocks.levels.mockResolvedValue([]);
    const response = await POST(request({ mode: 'preview', mappings: [{ shopifyLocationId: 10, solvantisLocationId: 1 }] }));
    expect(await response.json()).toMatchObject({ skipped_levels: 1, lines: [], apply_batches: [] });
  });

  it('rejects missing mappings and confirmation without stock writes', async () => {
    expect((await POST(request({ mode: 'preview', mappings: [] }))).status).toBe(400);
    expect((await POST(request({ mode: 'apply', run_id: '12345678', snapshot: snapshot() }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects cross-store snapshots and changed inventory links before writing', async () => {
    expect((await POST(request({ mode: 'apply', channelInstanceId: 'store-2', run_id: '12345678', snapshot: snapshot(), confirmation: 'REPLACE SOLVANTIS STOCK' }))).status).toBe(400);
    mocks.query.mockResolvedValue([{ variant_id: 'v1', external_inventory_id: 'changed' }]);
    expect((await POST(request({ mode: 'apply', run_id: '12345678', snapshot: snapshot(), confirmation: 'REPLACE SOLVANTIS STOCK' }))).status).toBe(500);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalled();
  });

  it('applies a confirmed mapped snapshot through audited stocktakes', async () => {
    const response = await POST(request({ mode: 'apply', run_id: '12345678', snapshot: snapshot(), confirmation: 'REPLACE SOLVANTIS STOCK' }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ location_id: 1, blank: true }), 'biz-1');
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', stocktakeId: 123 }));
    expect(mocks.execute.mock.calls[0][1]).toEqual([123, 8, null, 1, 'v1', 'biz-1']);
  });

  it('blocks read-only advisors', async () => {
    mocks.session.mockResolvedValue({ businessId: 'biz-1', tier: 'Advisor' });
    expect((await POST(request({ mode: 'apply' }))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
