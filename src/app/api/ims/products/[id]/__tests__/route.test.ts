import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  get: vi.fn(),
  deleteProduct: vi.fn(),
  fallback: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsProductsRepo: { get: mocks.get, delete: mocks.deleteProduct },
  ImsVariantsRepo: {},
}));
vi.mock('@/lib/shopifyFallbackVariant', () => ({
  isReservedShopifyFallbackSku: vi.fn(),
  isShopifyFallbackProduct: mocks.fallback,
}));

import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { DELETE } from '../route';

describe('DELETE IMS product', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.get.mockResolvedValue({ product_id: 'p-1' });
    mocks.fallback.mockResolvedValue(false);
  });

  it('returns FIFO catalogue conflicts as an actionable 409', async () => {
    mocks.deleteProduct.mockRejectedValue(new FifoCostingConflict('Deactivate this product instead.'));

    const response = await DELETE(new Request('http://localhost/api/ims/products/p-1'), { params: { id: 'p-1' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false, code: 'FIFO_COSTING_CONFLICT', error: 'Deactivate this product instead.',
    });
    expect(mocks.deleteProduct).toHaveBeenCalledWith('p-1', 'biz-1');
  });
});
