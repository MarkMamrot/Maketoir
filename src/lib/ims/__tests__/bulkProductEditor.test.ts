import { describe, expect, it } from 'vitest';
import {
  bulkFillTargets,
  enabledBulkProductFields,
  optionCombinations,
  populateBlankProductSkus,
  reconcileVariantMatrix,
  sanitizeBulkProductFieldSelection,
} from '../bulkProductEditor';
import type { ProductSettings } from '../productSettings';

const settings: ProductSettings = {
  showCategories: false,
  showProductType: true,
  showTags: true,
  showWholesalePrice: false,
  showWeight: true,
  allowOpeningStock: true,
  showReplenishmentQuantities: false,
};

describe('bulkProductEditor', () => {
  it('builds up to three option dimensions', () => {
    expect(optionCombinations([
      { name: 'Size', values: 'S, M' },
      { name: 'Colour', values: 'Navy, White' },
    ])).toEqual([
      ['S', 'Navy', ''],
      ['S', 'White', ''],
      ['M', 'Navy', ''],
      ['M', 'White', ''],
    ]);
  });

  it('preserves matching edits and keeps unmatched saved variants visible', () => {
    const result = reconcileVariantMatrix('HLS', [{ name: 'Size', values: 'S, M' }], [
      { clientId: 'saved-s', variantId: 'variant-s', option1Value: 'S', option2Value: '', option3Value: '', sku: 'CUSTOM-S', barcode: '123' },
      { clientId: 'saved-l', variantId: 'variant-l', option1Value: 'L', option2Value: '', option3Value: '', sku: 'HLS-L' },
      { clientId: 'unsaved-xl', option1Value: 'XL', option2Value: '', option3Value: '', sku: 'HLS-XL' },
    ], () => 'new-m');

    expect(result.variants).toEqual([
      expect.objectContaining({ clientId: 'saved-s', sku: 'CUSTOM-S', barcode: '123' }),
      expect.objectContaining({ clientId: 'new-m', sku: 'HLS-M' }),
      expect.objectContaining({ clientId: 'saved-l', sku: 'HLS-L' }),
    ]);
    expect(result.unmatchedExisting.map(variant => variant.clientId)).toEqual(['saved-l']);
  });

  it('keeps a saved legacy Default variant as the sole default', () => {
    const existing = { clientId: 'saved-default', variantId: 'variant-1', option1Value: 'Default', option2Value: '', option3Value: '', sku: 'BASE' };

    const result = reconcileVariantMatrix('BASE', [{ name: '', values: '' }], [existing], () => 'new-default');

    expect(result.variants).toEqual([existing]);
    expect(result.unmatchedExisting).toEqual([]);
  });

  it('generates only blank product SKUs and advances timestamps', () => {
    const rows = populateBlankProductSkus([
      { brand: 'Monster Threads', baseSku: '' },
      { brand: 'Monster Threads', baseSku: 'KEEP-ME' },
      { brand: 'Monster Threads' },
    ], new Date(2026, 7, 31, 14, 5, 9));

    expect(rows.map(row => row.baseSku)).toEqual([
      'MON-260831-140509',
      'KEEP-ME',
      'MON-260831-140510',
    ]);
  });

  it('filters disabled fields and restores required fields in stored selections', () => {
    const available = enabledBulkProductFields(settings, false);
    expect(available.some(field => field.id === 'category')).toBe(false);
    expect(available.some(field => field.id === 'price_wholesale')).toBe(false);
    expect(available.some(field => field.id === 'cost_foreign')).toBe(false);
    expect(available.some(field => field.id === 'sku')).toBe(false);
    expect(sanitizeBulkProductFieldSelection(['brand', 'category', 42], available)).toEqual([
      'name',
      'base_sku',
      'brand',
    ]);
  });

  it('selects every compatible row in a fill range without crossing row ownership', () => {
    const rows = [
      { id: 'product-1', owner: 'product' as const, productClientId: 'product-1' },
      { id: 'variant-1', owner: 'variant' as const, productClientId: 'product-1', variantClientId: 'variant-1' },
      { id: 'variant-2', owner: 'variant' as const, productClientId: 'product-1', variantClientId: 'variant-2' },
      { id: 'product-2', owner: 'product' as const, productClientId: 'product-2' },
      { id: 'variant-3', owner: 'variant' as const, productClientId: 'product-2', variantClientId: 'variant-3' },
    ];

    expect(bulkFillTargets(rows, 'variant-1', 'variant-3', 'variant').map(row => row.id)).toEqual([
      'variant-1',
      'variant-2',
      'variant-3',
    ]);
    expect(bulkFillTargets(rows, 'product-1', 'product-2', 'product').map(row => row.id)).toEqual([
      'product-1',
      'product-2',
    ]);
  });
});