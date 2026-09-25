import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  deleteVariant: vi.fn(),
  updateVariantRecord: vi.fn(),
  getVariant: vi.fn(),
  fallback: vi.fn(),
  query: vi.fn(),
  context: vi.fn(),
  updateShopifyVariant: vi.fn(),
  updateShopifyProduct: vi.fn(),
  report: vi.fn(),
  notify: vi.fn(),
  listInstances: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsVariantsRepo: {
  delete: mocks.deleteVariant, update: mocks.updateVariantRecord, get: mocks.getVariant,
  findIdentifierConflict: vi.fn(),
} }));
vi.mock('@/lib/shopifyFallbackVariant', () => ({ isShopifyFallbackVariant: mocks.fallback }));
vi.mock('@/lib/ims/shopifyInventorySync', () => ({ shopifyVariantPricePayload: vi.fn(() => ({ price: '20.00', compare_at_price: null })) }));
vi.mock('@/lib/ims/notifySyncFailure', () => ({ notifySyncFailure: mocks.notify }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: mocks.context }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class {
  constructor(readonly domain: string) {}
  updateVariant(id: string, payload: unknown) { return mocks.updateShopifyVariant(this.domain, id, payload); }
  updateProduct(id: string, payload: unknown) { return mocks.updateShopifyProduct(this.domain, id, payload); }
} }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/channels/channelInstanceRepository', () => ({
  SalesChannelInstanceRepository: { listForBusiness: mocks.listInstances },
}));

import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { DELETE, PUT } from '../route';

describe('DELETE IMS variant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.fallback.mockResolvedValue(false);
    mocks.notify.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(undefined);
    mocks.listInstances.mockResolvedValue([
      { provider: 'shopify', channelInstanceId: 'store-a' },
      { provider: 'shopify', channelInstanceId: 'store-b' },
    ]);
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

  it('fans a variant mutation out through exact mappings and isolates one store failure', async () => {
    mocks.getVariant.mockResolvedValue({ variant_id: 'v-1', price_rrp: 20, price_rrp_sale: null, sku: 'SKU-1', barcode: '123' });
    mocks.query.mockResolvedValue([
      { channel_instance_id: 'store-a', external_variant_id: 'variant-a' },
      { channel_instance_id: 'store-b', external_variant_id: 'variant-b' },
    ]);
    mocks.context.mockImplementation(({ channelInstanceId }) => ({
      credentials: { shopDomain: `${channelInstanceId}.myshopify.com`, token: 'secret' },
    }));
    mocks.updateShopifyVariant.mockImplementation((domain: string) => {
      if (domain.startsWith('store-a')) throw new Error('Store A unavailable');
    });

    const response = await PUT(new Request('http://localhost/api/ims/variants/v-1', {
      method: 'PUT', body: JSON.stringify({ price_rrp: 20 }),
    }), { params: { id: 'v-1' } });

    expect(response.status).toBe(200);
    expect(mocks.updateShopifyVariant).toHaveBeenCalledTimes(2);
    expect(mocks.updateShopifyVariant).toHaveBeenCalledWith(
      'store-b.myshopify.com', 'variant-b', expect.objectContaining({ price: '20.00' }),
    );
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ channelInstanceId: 'store-a', externalVariantId: 'variant-a' }),
    }));
    expect(mocks.updateShopifyProduct).not.toHaveBeenCalled();
  });
});
