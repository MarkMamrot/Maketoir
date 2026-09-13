import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  deleteVariant: vi.fn(),
  fallback: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsVariantsRepo: { delete: mocks.deleteVariant } }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ isShopifyFallbackVariant: mocks.fallback }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({ getShopifyForBusiness: vi.fn(), shopifyVariantPricePayload: vi.fn() }));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: vi.fn() }));

import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { DELETE } from '../route';

describe('DELETE IMS variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.fallback.mockResolvedValue(false);
  });

  it('returns FIFO catalogue conflicts as an actionable 409', async () => {
    mocks.deleteVariant.mockRejectedValue(new FifoCostingConflict('Deactivate this variant instead.'));

    const response = await DELETE(new Request('http://localhost/api/ims/variants/v-1'), { params: { id: 'v-1' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false, code: 'FIFO_COSTING_CONFLICT', error: 'Deactivate this variant instead.',
    });
    expect(mocks.deleteVariant).toHaveBeenCalledWith('v-1', 'biz-1');
  });
});
