import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));

import { GET } from '../route';

describe('wholesale catalogue media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session: { businessId: 'biz-1' }, brandAccess: { mode: 'all', brands: null },
    });
  });

  it('returns all ordered images and keeps the first as image_url', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 1, product_id: 'product-1', name: 'Raincoat', allow_indent_wholesale: 0 }])
      .mockResolvedValueOnce([{ id: 2, variant_id: 'variant-1', product_id: 'product-1', sku: 'RAIN', price_wholesale: 20 }])
      .mockResolvedValueOnce([{ variant_id: 'variant-1', available: 5 }])
      .mockResolvedValueOnce([{ product_id: 'product-1', url: 'primary.jpg' }, { product_id: 'product-1', url: 'detail.jpg' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost/api/wholesale/products'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products[0]).toEqual(expect.objectContaining({
      image_url: 'primary.jpg', images: ['primary.jpg', 'detail.jpg'],
    }));
    expect(mocks.imsQuery.mock.calls[3][0]).toContain('ORDER BY product_id, is_primary DESC, sort_order ASC, id ASC');
  });
});