import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), query: vi.fn(), execute: vi.fn(), products: vi.fn(), create: vi.fn(), update: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.session }));
vi.mock('@/lib/shopifyCapability', () => ({ shopifyDisabledResponse: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/channels/shopifyOperationContext', () => ({ getShopifyOperationContext: vi.fn().mockResolvedValue({
  credentials: { shopDomain: 'store.myshopify.com', token: 'secret' },
}) }));
vi.mock('@/services/ShopifyService', () => ({ ShopifyService: class { getProductsPage = mocks.products; } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsProductsRepo: { create: mocks.create, update: mocks.update },
  ImsVariantsRepo: { create: vi.fn().mockResolvedValue('v1') },
  ImsShopifyRepo: { linkVariant: vi.fn(), logAction: vi.fn().mockResolvedValue(undefined) },
  ImsBrandsRepo: { list: vi.fn(), create: vi.fn() },
  ImsContactsRepo: { list: vi.fn(), create: vi.fn() },
  ImsImagesRepo: { upsertFromShopify: vi.fn() },
}));
import { POST } from '../route';

function request(autoCreate: boolean) {
  return new Request('http://localhost/api/ims/shopify/import-products', {
    method: 'POST', body: JSON.stringify({ channelInstanceId: 'store-1', auto_create_product_skus: autoCreate }),
  });
}
describe('Shopify import parent SKUs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ businessId: 'biz-1' });
    mocks.products.mockResolvedValue({ products: [{ id: 100, title: 'Erin Pants', vendor: 'Sylvia Riley',
      variants: [{ id: 200, sku: 'Erin/L', option1: 'L', inventory_item_id: 300 }] }], hasMore: false });
    mocks.query.mockResolvedValue([]);
    mocks.create.mockResolvedValue('product-1');
    mocks.update.mockResolvedValue(undefined);
  });
  it('fills the parent SKU from Shopify variant options when opted in', async () => {
    expect((await POST(request(true))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ base_sku: 'Erin' }), 'biz-1');
  });
  it('does not create parent SKUs when the checkbox is off', async () => {
    expect((await POST(request(false))).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ base_sku: undefined }), 'biz-1');
  });
  it('preserves a linked product parent SKU and assigned supplier', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM ims_products')
      ? [{ product_id: 'product-1', shopify_product_id: '100', base_sku: 'KEEP', supplier_contact_id: 17 }]
      : []);
    expect((await POST(request(true))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('product-1', expect.objectContaining({
      supplier_contact_id: 17, base_sku: 'KEEP',
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
