import { describe, expect, it } from 'vitest';
import { createMissingShopifyProductSku, inferShopifyProductSku, planMissingShopifyVariantSku } from '../shopifyProductSku';

describe('blank-only Shopify variant SKU repair', () => {
  const remote = {
    id: 'gid://shopify/ProductVariant/22', sku: null, product: { id: 'gid://shopify/Product/11' },
    inventoryItem: { sku: '' },
  };
  const mapping = { variant_id: 'local-1', external_product_id: '11', external_variant_id: '22', sku: '00123' };

  it('fills only a blank SKU from one exact storefront variant mapping', () => {
    expect(planMissingShopifyVariantSku(remote, [mapping])).toEqual({
      variantId: '22', productId: '11', localVariantId: 'local-1', sku: '00123',
    });
    expect(planMissingShopifyVariantSku({ ...remote, sku: '  ' }, [mapping])).toHaveProperty('sku', '00123');
  });

  it('preserves every existing Shopify SKU, even when it differs from Solvantis', () => {
    expect(planMissingShopifyVariantSku({ ...remote, sku: 'KEEP' }, [mapping])).toBeNull();
    expect(planMissingShopifyVariantSku({ ...remote, inventoryItem: { sku: 'KEEP' } }, [mapping])).toBeNull();
    expect(planMissingShopifyVariantSku({ ...remote, sku: '0' }, [mapping])).toBeNull();
  });

  it('refuses absent, stale, ambiguous or wrong-product mappings', () => {
    expect(planMissingShopifyVariantSku(remote, [])).toHaveProperty('reason', 'No unique exact mapping');
    expect(planMissingShopifyVariantSku(remote, [{ ...mapping, external_variant_id: '99' }])).toHaveProperty('reason');
    expect(planMissingShopifyVariantSku(remote, [mapping, { ...mapping, variant_id: 'local-2' }])).toHaveProperty('reason');
    expect(planMissingShopifyVariantSku(remote, [{ ...mapping, external_product_id: '99' }]))
      .toHaveProperty('reason', 'Product ownership mismatch');
  });

  it.each([null, '', '  '])('does not invent a code when the Solvantis SKU is %s', sku => {
    expect(planMissingShopifyVariantSku(remote, [{ ...mapping, sku }])).toHaveProperty('reason', 'IMS SKU is blank');
  });
});

describe('Shopify parent SKU inference', () => {
  it('recognises slash, hyphen and mixed separators without truncating the base', () => {
    expect(inferShopifyProductSku([
      { sku: 'Erin/L', option1_value: 'L' }, { sku: 'Erin-M', option1_value: 'M' },
    ])).toBe('Erin');
    expect(inferShopifyProductSku([
      { sku: 'SR-Erin/mercury/L', option1_value: 'L', option2_value: 'Mercury' },
      { sku: 'SR-Erin-mercury-M', option1_value: 'M', option2_value: 'Mercury' },
    ])).toBe('SR-Erin');
  });

  it('handles all three options and literal regular expression characters', () => {
    expect(inferShopifyProductSku([
      { sku: 'Coat/Black/XL (2)/Tall', option1_value: 'Tall', option2_value: 'Black', option3_value: 'XL (2)' },
    ])).toBe('Coat');
  });

  it('does not guess arbitrary prefixes, inconsistent or incomplete variant SKUs', () => {
    expect(inferShopifyProductSku([{ sku: 'ABC-L', option1_value: 'Medium' }])).toBeNull();
    expect(inferShopifyProductSku([{ sku: 'ABC/L', option1_value: 'L' }, { sku: 'XYZ/M', option1_value: 'M' }])).toBeNull();
    expect(inferShopifyProductSku([{ sku: 'ABC/L', option1_value: 'L' }, { sku: null, option1_value: 'M' }])).toBeNull();
    expect(inferShopifyProductSku([])).toBeNull();
    expect(inferShopifyProductSku([{ sku: 'ONLY', option1_value: 'Default Title' }])).toBe('ONLY');
  });

  it('uses the bulk brand/date/time format for fallbacks and avoids collisions', () => {
    const used = new Set(['erin', 'syl-261015-120000']);
    const now = new Date(2026, 9, 15, 12, 0, 0);
    expect(createMissingShopifyProductSku('Sylvia Riley', [{ sku: 'Erin/L', option1_value: 'L' }], used, now))
      .toEqual({ sku: 'SYL-261015-120001', inferred: false });
    expect(createMissingShopifyProductSku('', [], used, now)).toEqual({ sku: 'SOL-261015-120000', inferred: false });
    expect(createMissingShopifyProductSku('Sylvia Riley', [{ sku: 'New/M', option1_value: 'M' }], used, now))
      .toEqual({ sku: 'New', inferred: true });
  });
});
