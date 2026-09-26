import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(), execute: vi.fn(), query: vi.fn(), setInventory: vi.fn(), report: vi.fn(), notify: vi.fn(),
  listInstances: vi.fn(), markInventorySynced: vi.fn(),
}));

vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.execute, imsQuery: mocks.query }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyService: class {
    constructor(readonly domain: string) {}
    setInventoryLevelsBulk(items: unknown[], locationId: number) {
      return mocks.setInventory(this.domain, items, locationId);
    }
  },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/createNotification', () => ({ createNotification: mocks.notify }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsShopifyRepo: { logAction: vi.fn() } }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: {
    listForBusiness: mocks.listInstances,
    markShopifyInventorySyncedForBusiness: mocks.markInventorySynced,
  },
}));

import {
  drainInventoryQueue,
  fanOutLegacyShopifyInventoryQueue,
  pushInventoryForShopifyInstance,
  shopifyInventoryPolicyPayload,
  shouldRunInventorySync,
} from '../shopifyInventorySync';

function operationContext(channelInstanceId: string) {
  const storeNumber = channelInstanceId === 'store-a' ? 1 : 2;
  return {
    businessId: 'biz-1', channelInstanceId,
    credentials: { shopDomain: `${channelInstanceId}.myshopify.com`, token: 'secret' },
    instance: {
      settings: { shopify: { inventory: {
        enabled: true, locationId: 100 + storeNumber,
        pickLocationIds: [storeNumber], buffer: storeNumber,
      } } },
    },
  };
}

describe('shouldRunInventorySync', () => {
  it('runs immediately when there is no previous run', () => {
    expect(shouldRunInventorySync(null, 15, new Date('2024-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('runs when the configured interval has elapsed', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:15:00.000Z'))).toBe(true);
  });

  it('skips when the interval has not elapsed yet', () => {
    expect(shouldRunInventorySync('2024-01-01T00:00:00.000Z', 15, new Date('2024-01-01T00:14:59.000Z'))).toBe(false);
  });
});

describe('shopifyInventoryPolicyPayload', () => {
  it('tracks stock products and denies overselling', () => {
    expect(shopifyInventoryPolicyPayload(1)).toEqual({ inventory_management: 'shopify', inventory_policy: 'deny' });
  });

  it('does not manage inventory for untracked products and continues selling', () => {
    expect(shopifyInventoryPolicyPayload(0)).toEqual({ inventory_management: null, inventory_policy: 'continue' });
  });
});

describe('exact-instance Shopify inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.markInventorySynced.mockResolvedValue(undefined);
    mocks.listInstances.mockResolvedValue([
      { provider: 'shopify', channelInstanceId: 'store-a', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready', settings: operationContext('store-a').instance.settings },
      { provider: 'shopify', channelInstanceId: 'store-b', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready', settings: operationContext('store-b').instance.settings },
    ]);
    mocks.report.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
    mocks.context.mockImplementation(({ channelInstanceId }) => operationContext(channelInstanceId));
    mocks.setInventory.mockResolvedValue({ count: 1, userErrors: [] });
    mocks.query.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM ims_sales_channel_product_mappings mapping')) {
        return [{ variant_id: 'variant-1', external_inventory_id: params[1] === 'store-a' ? 'inventory-a' : 'inventory-b' }];
      }
      if (sql.includes('FROM ims_stock')) {
        return [{ variant_id: 'variant-1', available: params[0] === 1 ? 8 : 20 }];
      }
      return [];
    });
  });

  it('uses isolated inventory locations, IMS locations, and buffers for two stores', async () => {
    await pushInventoryForShopifyInstance({ businessId: 'biz-1', channelInstanceId: 'store-a', all: true });
    await pushInventoryForShopifyInstance({ businessId: 'biz-1', channelInstanceId: 'store-b', all: true });

    expect(mocks.setInventory).toHaveBeenNthCalledWith(
      1, 'store-a.myshopify.com', [{ inventoryItemId: 'inventory-a', available: 7 }], 101,
    );
    expect(mocks.setInventory).toHaveBeenNthCalledWith(
      2, 'store-b.myshopify.com', [{ inventoryItemId: 'inventory-b', available: 18 }], 102,
    );
    expect(mocks.markInventorySynced).toHaveBeenCalledWith({ businessId: 'biz-1', channelInstanceId: 'store-a' });
    expect(mocks.markInventorySynced).toHaveBeenCalledWith({ businessId: 'biz-1', channelInstanceId: 'store-b' });
  });

  it('fans out legacy jobs only to eligible instances with collation-safe joins', async () => {
    mocks.listInstances.mockResolvedValue([
      { provider: 'shopify', channelInstanceId: 'store-a', enabled: true, runtimeStatus: 'active', readinessStatus: 'ready', settings: operationContext('store-a').instance.settings },
      { provider: 'shopify', channelInstanceId: 'store-disabled', enabled: false, runtimeStatus: 'paused', readinessStatus: 'ready', settings: operationContext('store-b').instance.settings },
    ]);

    await fanOutLegacyShopifyInventoryQueue('biz-1');

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    for (const [sql, params] of mocks.execute.mock.calls) {
      expect(sql).toContain('variant.variant_id = queue_item.variant_id');
      expect(sql).toContain('product.product_id = variant.product_id');
      expect(sql).toContain('BINARY mapping.business_id = BINARY product.business_id');
      expect(sql).toContain('BINARY mapping.variant_id = BINARY variant.variant_id');
      expect(params).toContain('store-a');
      expect(params).not.toContain('store-disabled');
    }
  });

  it('completes one store when another store fails', async () => {
    mocks.query.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM ims_sales_channel_jobs')) {
        return [
          { id: 1, channel_instance_id: 'store-a', payload_json: { variantId: 'variant-1' }, attempts: 0 },
          { id: 2, channel_instance_id: 'store-b', payload_json: { variantId: 'variant-1' }, attempts: 0 },
        ];
      }
      if (sql.includes('FROM ims_sales_channel_product_mappings mapping')) {
        return [{ variant_id: 'variant-1', external_inventory_id: params[1] === 'store-a' ? 'inventory-a' : 'inventory-b' }];
      }
      if (sql.includes('FROM ims_stock')) return [{ variant_id: 'variant-1', available: 10 }];
      return [];
    });
    mocks.setInventory.mockImplementation((domain: string) => {
      if (domain.startsWith('store-a')) throw new Error('Store A unavailable');
      return { count: 1, userErrors: [] };
    });

    const result = await drainInventoryQueue(10, 'biz-1');

    expect(result).toMatchObject({ processed: 2, pushed: 1, businesses: 2 });
    expect(result.errors).toContain('batch @0: Store A unavailable');
    expect(mocks.setInventory).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'complete'"), ['biz-1', 'store-b', 2],
    );
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', context: expect.objectContaining({ channelInstanceId: 'store-a' }),
    }));
  });
});
