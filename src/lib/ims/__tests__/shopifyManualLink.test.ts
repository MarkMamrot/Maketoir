import { describe, expect, it } from 'vitest';
import { matchShopifyVariants, parseShopifyProductId } from '../shopifyManualLink';

describe('parseShopifyProductId', () => {
  it('accepts a numeric ID or extracts it from a Shopify Admin product URL', () => {
    expect(parseShopifyProductId('9404164997336')).toBe('9404164997336');
    expect(parseShopifyProductId('https://admin.shopify.com/store/monsterthreads/products/9404164997336')).toBe('9404164997336');
  });

  it('rejects malformed and non-product values', () => {
    expect(parseShopifyProductId('')).toBeNull();
    expect(parseShopifyProductId('https://admin.shopify.com/store/example/orders/9404164997336')).toBeNull();
    expect(parseShopifyProductId('product-123')).toBeNull();
  });
});

describe('matchShopifyVariants', () => {
  it('matches unique exact SKUs and falls back to a unique exact barcode', () => {
    expect(matchShopifyVariants(
      [
        { variant_id: 'local-1', sku: 'SKU-1', barcode: '111' },
        { variant_id: 'local-2', sku: null, barcode: '222' },
      ],
      [
        { id: 10, inventory_item_id: 100, sku: 'sku-1', barcode: '111' },
        { id: 20, inventory_item_id: 200, sku: 'other', barcode: '222' },
      ],
    )).toEqual([
      { variantId: 'local-1', shopifyVariantId: '10', shopifyInventoryItemId: '100' },
      { variantId: 'local-2', shopifyVariantId: '20', shopifyInventoryItemId: '200' },
    ]);
  });

  it('does not guess when identifiers are ambiguous or disagree', () => {
    expect(matchShopifyVariants(
      [
        { variant_id: 'ambiguous', sku: 'DUP', barcode: null },
        { variant_id: 'conflict', sku: 'SKU-A', barcode: 'BAR-B' },
      ],
      [
        { id: 1, inventory_item_id: 11, sku: 'DUP', barcode: 'BAR-A' },
        { id: 2, inventory_item_id: 22, sku: 'DUP', barcode: 'OTHER' },
        { id: 3, inventory_item_id: 33, sku: 'SKU-A', barcode: 'OTHER-2' },
        { id: 4, inventory_item_id: 44, sku: 'OTHER-3', barcode: 'BAR-B' },
      ],
    )).toEqual([]);
  });
});