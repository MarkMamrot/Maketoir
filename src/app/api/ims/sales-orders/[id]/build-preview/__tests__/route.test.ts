import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getImsSession: vi.fn(),
  imsQuery: vi.fn(),
  resolveBuildFromSalePolicy: vi.fn(),
  previewProductBuildBatch: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/ims/builds/buildFromSalePolicy', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ims/builds/buildFromSalePolicy')>();
  return { ...actual, resolveBuildFromSalePolicy: mocks.resolveBuildFromSalePolicy };
});
vi.mock('@/lib/ims/builds/buildService', () => ({ previewProductBuildBatch: mocks.previewProductBuildBatch }));

import { POST } from '../route';

describe('POST /api/ims/sales-orders/[id]/build-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImsSession.mockResolvedValue({ businessId: 'biz-1', userId: 7, name: 'Builder' });
    mocks.resolveBuildFromSalePolicy.mockResolvedValue({ enabled: true });
  });

  it('reports ready, buildable, and unavailable quantities without subtracting the confirmed order commitment twice', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 14, status: 'confirmed', location_id: 4, sales_channel: null, so_type: 'sales_order' }])
      .mockResolvedValueOnce([{ id: 98, variant_id: 'gift-pack', qty_ordered: 3, qty_fulfilled: 0, product_name: 'Gift Pack', sku: 'GIFT', revision: 3 }])
      .mockResolvedValueOnce([{ variant_id: 'gift-pack', qty_on_hand: 1, qty_committed: 3 }]);
    mocks.previewProductBuildBatch.mockResolvedValue({
      canComplete: false,
      builds: [{ outputVariantId: 'gift-pack', quantity: 2, buildableQuantity: 1, unavailableQuantity: 1 }],
      components: [{ variantId: 'chain', productName: 'Chain', sku: 'CHAIN', available: 1, required: 2, after: -1 }],
    });

    const response = await POST(new Request('http://localhost/api/ims/sales-orders/14/build-preview', {
      method: 'POST',
      body: JSON.stringify({ mode: 'confirm' }),
    }), { params: { id: '14' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.previewProductBuildBatch).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      locationId: 4,
      builds: [expect.objectContaining({ outputVariantId: 'gift-pack', quantity: 2 })],
    }));
    expect(body.data.availability).toEqual([expect.objectContaining({
      productName: 'Gift Pack', requestedQuantity: 3, readyQuantity: 1, buildableQuantity: 1, unavailableQuantity: 1,
    })]);
  });
});
