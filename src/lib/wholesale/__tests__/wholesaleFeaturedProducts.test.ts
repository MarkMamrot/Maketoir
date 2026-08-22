import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  imsQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { getPublicWholesaleProductTeasers } from '../wholesaleFeaturedProducts';

describe('public wholesale featured product teasers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only allowlisted teaser fields in configured order inside tenant context', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ product_id: 'p-2', name: 'Second' }, { product_id: 'p-1', name: 'First' }])
      .mockResolvedValueOnce([{ product_id: 'p-1', url: 'https://images.example/one.jpg' }]);

    await expect(getPublicWholesaleProductTeasers('biz-1', ['p-1', 'p-2', 'p-1'])).resolves.toEqual([
      { product_id: 'p-1', name: 'First', image_url: 'https://images.example/one.jpg' },
      { product_id: 'p-2', name: 'Second', image_url: null },
    ]);
    expect(mocks.runImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['biz-1', 'p-1', 'p-2']);
  });

  it('does not enter tenant context when no products are explicitly configured', async () => {
    await expect(getPublicWholesaleProductTeasers('biz-1', [])).resolves.toEqual([]);
    expect(mocks.runImsForBusiness).not.toHaveBeenCalled();
  });

  it('reports image lookup failures without exposing additional product data', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{ product_id: 'p-1', name: 'First' }]).mockRejectedValueOnce(new Error('missing images'));
    await expect(getPublicWholesaleProductTeasers('biz-1', ['p-1'])).resolves.toEqual([{ product_id: 'p-1', name: 'First', image_url: null }]);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'load_public_featured_product_images' }));
  });
});
