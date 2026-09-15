import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), access: vi.fn(), update: vi.fn(), locations: vi.fn(),
  report: vi.fn(), run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('../amazonSpApi', () => ({ updateAmazonListingInventory: mocks.update }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({ getOnlinePickLocationIds: mocks.locations }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));

import { enqueueAmazonInventoryJobs, processAmazonInventoryJobs, syncAmazonInventoryForChannel } from '../amazonInventorySync';

describe('Amazon inventory synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.access.mockResolvedValue({ accessToken: 'access-token', sellerId: 'A1SELLER99' });
    mocks.locations.mockResolvedValue([2, 5]);
    mocks.update.mockResolvedValue({ sku: 'SELLER-SKU', status: 'ACCEPTED', submissionId: 'submission', issues: [] });
    mocks.report.mockResolvedValue(1);
  });

  it('queues only selected, inventory-enabled, linked stock items in the exact instance', async () => {
    await expect(enqueueAmazonInventoryJobs({ businessId: 'business-1', channelInstanceId: 'instance-1' })).resolves.toBe(1);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain("mapping.mapping_status = 'linked'");
    expect(sql).toContain('selection.is_selected = 1 AND selection.inventory_enabled = 1');
    expect(sql).toContain('COALESCE(product.is_stock_item, 1) = 1');
    expect(sql).toContain("status = IF(status = 'processing', status, 'pending')");
    expect(params).toEqual(['inventory_update', 'business-1', 'instance-1']);
  });

  it('revalidates the mapping and pushes current online availability', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 11, operation_key: 'amazon_inventory:variant-1',
        payload_json: '{"variantId":"variant-1"}', attempts: 0 }])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', seller_sku: 'SELLER-SKU' }])
      .mockResolvedValueOnce([{ available: '7.9' }]);
    await expect(processAmazonInventoryJobs({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ processed: 1, pushed: 1, skipped: 0, failed: 0 });
    expect(mocks.access).toHaveBeenCalledWith('business-1', 'instance-1');
    expect(mocks.query.mock.calls[2][1]).toEqual(['variant-1', 2, 5]);
    expect(mocks.update).toHaveBeenCalledWith('access-token', 'A1SELLER99', 'SELLER-SKU', 7);
  });

  it('retries a failed update and records a safe runtime issue', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 12, operation_key: 'amazon_inventory:variant-2',
        payload_json: { variantId: 'variant-2' }, attempts: 1 }])
      .mockResolvedValueOnce([{ variant_id: 'variant-2', seller_sku: 'SELLER-SKU-2' }])
      .mockResolvedValueOnce([{ available: 3 }]);
    mocks.update.mockRejectedValue(new Error('Amazon inventory update failed with HTTP 503.'));
    await expect(processAmazonInventoryJobs({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ processed: 1, pushed: 0, skipped: 0, failed: 1 });
    const retryCall = mocks.execute.mock.calls.find(call => String(call[0]).includes('DATE_ADD'));
    expect(retryCall?.[1]).toEqual(['pending', 60, 'Amazon inventory update failed with HTTP 503.', 12, 'business-1', 'instance-1']);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'push_inventory', context: expect.objectContaining({ channelInstanceId: 'instance-1', retry: true }),
    }));
  });

  it('uses callback tenant context for detached channel synchronization', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await syncAmazonInventoryForChannel({ businessId: 'business-1', channelInstanceId: 'instance-1' });
    expect(mocks.run).toHaveBeenCalledWith('business-1', expect.any(Function));
  });
});