import { describe, expect, it } from 'vitest';
import {
  planShopifyProductImport,
  planShopifyVariantImport,
  uniqueShopifyVariantIdentifier,
} from '../shopifyProductImport';

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

  it('creates a new variant when its barcode is already linked to another variant', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'NEW-SKU', barcode: '934000000001' },
      'product-1',
      [{
        variantId: 'variant-2',
        productId: 'product-2',
        shopifyVariantId: '201',
        sku: 'OLD-SKU',
        barcode: '934000000001',
      }],
    )).toEqual({ action: 'create' });
  });

  it('adopts one unlinked variant matched by barcode without creating a duplicate', () => {
    expect(planShopifyVariantImport(
      { id: 202, barcode: '934000000001' },
      'product-1',
      [{ variantId: 'variant-1', productId: 'product-1', barcode: '934000000001' }],
    )).toEqual({ action: 'use_existing', variantId: 'variant-1' });
  });

  it('adopts one unlinked variant matched by SKU', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'ABC-1' },
      'product-1',
      [{ variantId: 'variant-1', productId: 'product-1', sku: 'abc-1' }],
    )).toEqual({ action: 'use_existing', variantId: 'variant-1' });
  });

  it('creates a variant when its SKU belongs to an unlinked variant on another product', () => {
    expect(planShopifyVariantImport(
      { id: 202, sku: 'ABC-1' },
      'product-1',
      [{ variantId: 'variant-2', productId: 'product-2', sku: 'ABC-1' }],
    )).toEqual({ action: 'create' });
  });
});

describe('uniqueShopifyVariantIdentifier', () => {
  const variants = [
    { variantId: 'variant-1', productId: 'product-1', sku: 'SAME', barcode: '934000000001' },
    { variantId: 'variant-2', productId: 'product-2', sku: 'SAME-2', barcode: '934000000001-2' },
  ];

  it('adds the next available suffix case-insensitively', () => {
    expect(uniqueShopifyVariantIdentifier('same', 'sku', variants)).toBe('same-3');
    expect(uniqueShopifyVariantIdentifier('934000000001', 'barcode', variants)).toBe('934000000001-3');
  });

  it('excludes the current variant so reruns keep the same identifier', () => {
    expect(uniqueShopifyVariantIdentifier('SAME', 'sku', variants, 'variant-1')).toBe('SAME');
    expect(uniqueShopifyVariantIdentifier('934000000001', 'barcode', variants, 'variant-1')).toBe('934000000001');
  });

  it('keeps suffixed identifiers within the database column length', () => {
    const longIdentifier = 'A'.repeat(100);
    const existing = [{ variantId: 'variant-1', productId: 'product-1', sku: longIdentifier }];
    const result = uniqueShopifyVariantIdentifier(longIdentifier, 'sku', existing);

    expect(result).toBe(`${'A'.repeat(98)}-2`);
    expect(result).toHaveLength(100);
  });
});