import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShopifyService } from '../ShopifyService';

const saved = (sku: string | null) => ({
  id: 'gid://shopify/ProductVariant/22', sku, product: { id: 'gid://shopify/Product/11' },
  inventoryItem: { id: 'gid://shopify/InventoryItem/33', sku },
});
const service = () => new ShopifyService('example.myshopify.com', 'secret');
function response(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

describe('Shopify SKU persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes only the inventory-item SKU and verifies both SKU representations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      productVariantsBulkUpdate: { productVariants: [saved('00123')], userErrors: [] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await service().syncVariantSkus('11', [{ id: '22', sku: '00123' }]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.myshopify.com/admin/api/2026-07/graphql.json');
    expect(JSON.parse(request.body).variables).toEqual({
      productId: 'gid://shopify/Product/11',
      variants: [{ id: 'gid://shopify/ProductVariant/22', inventoryItem: { sku: '00123' } }],
    });
    expect(JSON.parse(request.body).query).toContain('allowPartialUpdates: false');
  });

  it.each([
    { productVariants: [saved(null)], userErrors: [] },
    { productVariants: [], userErrors: [] },
    { productVariants: [{ ...saved('00123'), inventoryItem: { id: '33', sku: '' } }], userErrors: [] },
    { productVariants: [{ ...saved('00123'), product: { id: 'gid://shopify/Product/99' } }], userErrors: [] },
  ])('rejects a successful response that did not persist the exact SKU and ownership', async update => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ productVariantsBulkUpdate: update })));
    await expect(service().syncVariantSkus('11', [{ id: '22', sku: '00123' }])).rejects.toThrow('did not persist SKU');
  });

  it('rejects user errors even on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      productVariantsBulkUpdate: { productVariants: null, userErrors: [{ message: 'Variant does not belong to product' }] },
    })));
    await expect(service().syncVariantSkus('11', [{ id: '22', sku: 'SKU' }])).rejects.toThrow('does not belong');
  });

  it.each([
    () => new Response('', { status: 429 }),
    () => new Response(JSON.stringify({ errors: [{ message: 'Access denied' }] }), { status: 200 }),
    () => new Response('{}', { status: 200 }),
  ])('surfaces HTTP, GraphQL and missing-data failures', async makeResponse => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));
    await expect(service().syncVariantSkus('11', [{ id: '22', sku: 'SKU' }])).rejects.toThrow();
  });

  it('never sends blank SKUs or an empty update', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await service().syncVariantSkus('11', []);
    await expect(service().syncVariantSkus('11', [{ id: '22', sku: '  ' }])).rejects.toThrow('nonblank');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves null lookups so a missing variant cannot be mistaken for another', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ nodes: [null, saved('SKU')] })));
    await expect(service().getSkuVariants(['21', '22'])).resolves.toEqual([null, saved('SKU')]);
  });

  it('reads the complete catalogue without filtering out draft or archived products', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ productVariants: {
      nodes: [saved(null)], pageInfo: { hasNextPage: true, endCursor: 'next' },
    } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await service().getSkuVariantsPage('previous')).pageInfo.endCursor).toBe('next');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.variables).toEqual({ after: 'previous' });
    expect(request.query).not.toContain('status:');
  });

  it('reads existing product options and enough variants to reject unsafe collapses without any mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ nodes: [null] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(service().getProductOptionsSnapshots(['11'])).resolves.toEqual([null]);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.variables).toEqual({ ids: ['gid://shopify/Product/11'] });
    expect(request.query).toContain('variants(first: 2)');
    expect(request.query).toContain('pageInfo { hasNextPage }');
    expect(request.query).not.toContain('mutation');
  });
});
