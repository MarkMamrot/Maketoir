import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicWholesaleProductTeasers: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('../wholesaleFeaturedProducts', () => ({ getPublicWholesaleProductTeasers: mocks.getPublicWholesaleProductTeasers }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { createDefaultWholesaleLayout } from '../layout/validation';
import { getWholesalePublicLoginProducts } from '../wholesalePublicLoginLayout';

describe('wholesale public Login layout data', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads only product IDs explicitly selected in the published Login layout', async () => {
    const published = createDefaultWholesaleLayout();
    published.pages.login.sections.push({ id: 'featured-1', type: 'featured_products', settings: { productIds: ['p-1', 'p-2'] } });
    mocks.getPublicWholesaleProductTeasers.mockResolvedValue([{ product_id: 'p-1', name: 'First', image_url: null }]);

    await expect(getWholesalePublicLoginProducts('biz-1', 'supplier', published)).resolves.toEqual([{ product_id: 'p-1', name: 'First', image_url: null }]);
    expect(mocks.getPublicWholesaleProductTeasers).toHaveBeenCalledWith('biz-1', ['p-1', 'p-2']);
  });

  it('reports tenant query failures and returns no public teaser data', async () => {
    const published = createDefaultWholesaleLayout();
    published.pages.login.sections.push({ id: 'featured-1', type: 'featured_products', settings: { productIds: ['p-1'] } });
    mocks.getPublicWholesaleProductTeasers.mockRejectedValue(new Error('tenant unavailable'));

    await expect(getWholesalePublicLoginProducts('biz-1', 'supplier', published)).resolves.toEqual([]);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz-1', operation: 'load_public_featured_products', context: { supplierSlug: 'supplier', requestedProductCount: 1 } }));
  });
});
