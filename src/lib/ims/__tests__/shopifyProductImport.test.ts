import { describe, expect, it } from 'vitest';
import { planShopifyProductImport, planShopifyVariantImport } from '../shopifyProductImport';

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

  it('creates a product instead of reassigning one already linked through a repeated SKU', () => {
    expect(planShopifyProductImport(
      { id: 102, variants: [{ id: 202, sku: 'GENERIC' }] },
      [{ productId: 'product-1', shopifyProductId: '101' }],
      [{ variantId: 'variant-1', productId: 'product-1', shopifyVariantId: '201', sku: 'GENERIC' }],
    )).toEqual({ action: 'create' });
  });

  it('creates a product when a repeated SKU belongs to several linked Shopify products', () => {
    expect(planShopifyProductImport(
      { id: 103, variants: [{ id: 203, sku: 'GENERIC' }] },
      [
        { productId: 'product-1', shopifyProductId: '101' },
        { productId: 'product-2', shopifyProductId: '102' },
      ],
      [
        { variantId: 'variant-1', productId: 'product-1', shopifyVariantId: '201', sku: 'GENERIC' },
        { variantId: 'variant-2', productId: 'product-2', shopifyVariantId: '202', sku: 'GENERIC' },
      ],
    )).toEqual({ action: 'create' });
  });
});

describe('planShopifyVariantImport', () => {
  it('creates another variant when a repeated SKU is already linked within the target product', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'GENERIC' },
      'product-1',
      [{ variantId: 'variant-1', productId: 'product-1', shopifyVariantId: '201', sku: 'GENERIC' }],
    )).toEqual({ action: 'create' });
  });

  it('creates a variant when a repeated SKU belongs to a linked variant on another product', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'GENERIC' },
      'product-1',
      [{ variantId: 'variant-2', productId: 'product-2', shopifyVariantId: '201', sku: 'GENERIC' }],
    )).toEqual({ action: 'create' });
  });

  it('adopts one unlinked variant matched by SKU', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'ABC-1' },
      'product-1',
      [{ variantId: 'variant-1', productId: 'product-1', sku: 'abc-1' }],
    )).toEqual({ action: 'use_existing', variantId: 'variant-1' });
  });

  it('skips an identifier match belonging to another product', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'ABC-1' },
      'product-1',
      [{ variantId: 'variant-2', productId: 'product-2', sku: 'ABC-1' }],
    ).action).toBe('skip');
  });
});