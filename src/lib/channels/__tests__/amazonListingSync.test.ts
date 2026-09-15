import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import { archiveMissingAmazonListingMappings, matchAmazonListingSku, syncAmazonListingMappings } from '../amazonListingSync';

describe('matchAmazonListingSku', () => {
  const variants = [
    { variant_id: 'one', sku: 'SKU-1' }, { variant_id: 'two', sku: 'DUPLICATE' },
    { variant_id: 'three', sku: 'duplicate' },
  ];
  it('links only one exact case-insensitive SKU match', () => {
    expect(matchAmazonListingSku(' sku-1 ', variants)).toEqual({ variantId: 'one', status: 'linked' });
  });
  it('leaves missing and duplicate SKUs unresolved', () => {
    expect(matchAmazonListingSku('missing', variants)).toEqual({ variantId: null, status: 'unmatched' });
    expect(matchAmazonListingSku('duplicate', variants)).toEqual({ variantId: null, status: 'conflict' });
  });
});

describe('syncAmazonListingMappings', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ affectedRows: 1 }); });

  it('tenant-scopes mappings and retains an existing valid external link', async () => {
    mocks.query
      .mockResolvedValueOnce([{ variant_id: 'one', sku: 'LOCAL-SKU' }])
      .mockResolvedValueOnce([{ external_variant_id: 'AMAZON-SKU', variant_id: 'one' }]);
    const result = await syncAmazonListingMappings({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      items: [{ sku: 'AMAZON-SKU', summaries: [{ asin: 'B001', itemName: 'Item' }] }],
      syncStartedAt: '2026-09-16 01:02:03.000',
    });
    expect(result).toEqual({ linked: 1, unmatched: 0, conflicts: 0 });
    expect(mocks.query.mock.calls[1][1]).toEqual(['business-1', 'instance-1']);
    expect(mocks.execute.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'business-1', 'instance-1', 'one', 'B001', 'AMAZON-SKU', 'linked',
    ]));
  });

  it('archives mappings not observed during the completed full synchronization', async () => {
    await archiveMissingAmazonListingMappings({
      businessId: 'business-1', channelInstanceId: 'instance-1', syncStartedAt: '2026-09-16 01:02:03.000',
    });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("mapping_status = 'archived'"), [
      'business-1', 'instance-1', '2026-09-16 01:02:03.000',
    ]);
  });
});