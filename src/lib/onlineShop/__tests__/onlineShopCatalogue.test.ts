import { describe, expect, it } from 'vitest';
import { projectOnlineShopProducts } from '../onlineShopCatalogue';

describe('online shop catalogue projection', () => {
  it('projects tax-inclusive retail units, sanitizes HTML, and ignores Shopify mappings', () => {
    const products = projectOnlineShopProducts([{ product_id: 'p1', slug: 'linen-shirt', name: 'Linen Shirt',
      description: '<p>Soft</p><script>alert(1)</script>', brand: 'North', category: 'Shirts', variant_id: 'v1',
      sku: 'LIN-S', barcode: null, option1_value: 'Small', option2_value: '', option3_value: null,
      retail_price: '89.95', compare_at_price: '109.95', available_units: '3.75' }],
    [{ id: 2, product_id: 'p1', url: 'https://example.test/shirt.jpg', alt_text: 'Shirt', sort_order: 0 }]);
    expect(products[0]).toMatchObject({ slug: 'linen-shirt', descriptionHtml: '<p>Soft</p>', variants: [{
      optionValues: ['Small'], price: { amount: 89.95, currency: 'AUD' }, compareAtPrice: { amount: 109.95, currency: 'AUD' }, availableUnits: 3 }] });
  });

  it('keeps sold-out variants browseable without negative availability', () => {
    const products = projectOnlineShopProducts([{ product_id: 'p1', slug: 'shirt', name: 'Shirt', description: null,
      brand: null, category: null, variant_id: 'v1', sku: null, barcode: null, option1_value: null,
      option2_value: null, option3_value: null, retail_price: 20, compare_at_price: null, available_units: -4 }], []);
    expect(products[0].variants[0].availableUnits).toBe(0);
  });

  it('marks untracked variants without inventing an available quantity', () => {
    const products = projectOnlineShopProducts([{ product_id: 'p1', slug: 'service', name: 'Service', description: null,
      brand: null, category: null, variant_id: 'v1', sku: null, barcode: null, option1_value: null,
      option2_value: null, option3_value: null, retail_price: 20, compare_at_price: null, available_units: 0,
      is_stock_item: 0 }], []);
    expect(products[0].variants[0]).toMatchObject({ availableUnits: 0, tracksInventory: false });
  });
});