import { describe, expect, it } from 'vitest';
import { planShopifyProductImport } from '../shopifyProductImport';

describe('planShopifyProductImport', () => {
  it('prefers an existing Shopify product link over identifier matches', () => {
    expect(planShopifyProductImport(
      { id: 101, variants: [{ id: 201, sku: 'SAME-SKU' }] },
      [{ productId: 'linked-product', shopifyProductId: '101' }],
      [{ variantId: 'other-variant', productId: 'other-product', sku: 'SAME-SKU' }],
    )).toEqual({ action: 'use_existing', productId: 'linked-product' });
  });

  it('adopts the one IMS product matched by an exact SKU', () => {
    expect(planShopifyProductImport(
      { id: 101, variants: [{ id: 201, sku: ' ABC-1 ' }] },
      [],
      [{ variantId: 'variant-1', productId: 'product-1', sku: 'abc-1' }],
    )).toEqual({ action: 'use_existing', productId: 'product-1' });
  });

  it('skips rather than guessing when identifiers match multiple IMS products', () => {
    const plan = planShopifyProductImport(
      { id: 101, variants: [{ id: 201, sku: 'ABC-1', barcode: '999' }] },
      [],
      [
        { variantId: 'variant-1', productId: 'product-1', sku: 'ABC-1' },
        { variantId: 'variant-2', productId: 'product-2', barcode: '999' },
      ],
    );

    expect(plan.action).toBe('skip');
    expect(plan).toMatchObject({ reason: expect.stringContaining('multiple Solvantis products') });
  });

  it('creates a product when no stable identifier matches', () => {
    expect(planShopifyProductImport(
      { id: 101, variants: [{ id: 201, sku: '' }] },
      [],
      [{ variantId: 'variant-1', productId: 'product-1', sku: 'OTHER' }],
    )).toEqual({ action: 'create' });
  });
});