import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShopifyService } from '../ShopifyService';
import type { ShopifyProductOptionsSnapshot } from '@/lib/ims/shopifyProductOptions';

function snapshot(simple = false): ShopifyProductOptionsSnapshot {
  const name = simple ? 'Title' : 'Size';
  const value = simple ? 'Default Title' : 'Default';
  return {
    id: 'gid://shopify/Product/11', title: 'Purse',
    options: simple ? [{ id: 'gid://shopify/ProductOption/44', name, values: [value] }]
      : [{ id: 'gid://shopify/ProductOption/44', name, values: [value] },
        { id: 'gid://shopify/ProductOption/45', name: 'Colour', values: ['Default'] }],
    variants: {
      nodes: [{ id: 'gid://shopify/ProductVariant/22', sku: '00123', barcode: '0001', price: '59.00',
        inventoryItem: { id: 'gid://shopify/InventoryItem/33' },
        selectedOptions: simple ? [{ name, value }] : [{ name, value }, { name: 'Colour', value: 'Default' }] }],
      pageInfo: { hasNextPage: false },
    },
  };
}
const service = () => new ShopifyService('example.myshopify.com', 'secret');
function mockResult(product: ShopifyProductOptionsSnapshot | null, userErrors: Array<{ message: string }> = []) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: { productOptionsDelete: { product, userErrors } },
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('non-destructive default-option repair', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes only option IDs with NON_DESTRUCTIVE and verifies all sellable identity evidence', async () => {
    const fetchMock = mockResult(snapshot(true));
    await expect(service().removeArtificialDefaultOptions(snapshot())).resolves.toEqual(snapshot(true));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.variables).toEqual({
      productId: 'gid://shopify/Product/11', options: ['gid://shopify/ProductOption/44', 'gid://shopify/ProductOption/45'],
    });
    expect(request.query).toContain('strategy: NON_DESTRUCTIVE');
    expect(request.query).not.toContain('productVariantsBulkDelete');
    expect(request.query).not.toContain('inventoryQuantities');
  });

  it('renames a sole default option and value in place without regenerating variants', async () => {
    const before = snapshot();
    before.options = [{ id: 'gid://shopify/ProductOption/44', name: 'Title', values: ['Default'],
      optionValues: [{ id: 'gid://shopify/ProductOptionValue/55', name: 'Default' }] }];
    before.variants.nodes[0].selectedOptions = [{ name: 'Title', value: 'Default' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { productOptionUpdate: { product: snapshot(true), userErrors: [] } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await service().removeArtificialDefaultOptions(before);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.query).toContain('variantStrategy: LEAVE_AS_IS');
    expect(request.variables).toEqual({
      productId: before.id, option: { id: before.options[0].id, name: 'Title' },
      values: [{ id: 'gid://shopify/ProductOptionValue/55', name: 'Default Title' }],
    });
  });
  it('refuses real options and multi-variant products before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const real = snapshot();
    real.options[0].values = ['Small'];
    await expect(service().removeArtificialDefaultOptions(real)).rejects.toThrow('placeholder-only');
    const multiple = snapshot();
    multiple.variants.nodes.push({ ...multiple.variants.nodes[0] });
    await expect(service().removeArtificialDefaultOptions(multiple)).rejects.toThrow('single Shopify variant');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['id', 'sku', 'barcode', 'price'] as const)('fails verification if Shopify changes variant %s', async key => {
    const after = snapshot(true);
    after.variants.nodes[0][key] = 'CHANGED';
    mockResult(after);
    await expect(service().removeArtificialDefaultOptions(snapshot())).rejects.toThrow('did not preserve');
  });

  it('fails verification if Shopify changes the inventory item or leaves options visible', async () => {
    const after = snapshot(true);
    after.variants.nodes[0].inventoryItem.id = 'gid://shopify/InventoryItem/99';
    mockResult(after);
    await expect(service().removeArtificialDefaultOptions(snapshot())).rejects.toThrow('did not preserve');
    mockResult(snapshot());
    await expect(service().removeArtificialDefaultOptions(snapshot())).rejects.toThrow('hidden Default Title');
  });

  it('surfaces provider rejection or an incomplete mutation response', async () => {
    mockResult(null, [{ message: 'Option deletion would remove variants' }]);
    await expect(service().removeArtificialDefaultOptions(snapshot())).rejects.toThrow('would remove variants');
    mockResult(null);
    await expect(service().removeArtificialDefaultOptions(snapshot())).rejects.toThrow('returned no product');
  });
});
