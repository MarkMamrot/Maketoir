import { describe, expect, it } from 'vitest';
import { resolveImportMatch } from '../importMatch';

describe('resolveImportMatch', () => {
  it('updates an existing variant when the CSV only supplies Product_SKU and no variant SKU', () => {
    const variantBySkuMap = new Map<string, { variant: { variant_id: string }; product: { product_id: string } }>([
      ['pomelb1st', { variant: { variant_id: 'v-1' }, product: { product_id: 'p-1' } }],
    ]);

    const match = resolveImportMatch({
      sku: '',
      barcode: '',
      product_sku: 'POMelb1st',
      product_name: 'Postcard Melb 1st',
      variantBySkuMap,
      productByNameMap: new Map(),
      productByBaseSkuMap: new Map(),
    });

    expect(match.action).toBe('update');
    expect(match.existing_variant_id).toBe('v-1');
    expect(match.existing_product_id).toBe('p-1');
  });

  it('classifies a known Product_SKU as a new variant when the product exists but the SKU is not a current variant', () => {
    const variantBySkuMap = new Map<string, { variant: { variant_id: string }; product: { product_id: string } }>([
      ['pomelb2nd', { variant: { variant_id: 'v-2' }, product: { product_id: 'p-1' } }],
    ]);

    const match = resolveImportMatch({
      sku: '',
      barcode: '',
      product_sku: 'POMelb1st',
      product_name: 'Postcard Melb 1st',
      variantBySkuMap,
      productByNameMap: new Map(),
      productByBaseSkuMap: new Map([['pomelb1st', { product_id: 'p-1' }]]),
    });

    expect(match.action).toBe('new_variant');
    expect(match.existing_product_id).toBe('p-1');
  });
});
