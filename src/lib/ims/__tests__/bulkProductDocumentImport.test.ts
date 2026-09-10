import { describe, expect, it } from 'vitest';
import { normalizeBulkProductDocumentImport } from '../bulkProductDocumentImport';

describe('bulk product document import', () => {
  it('normalizes extracted AUD invoice products and removes GST from inclusive cost', () => {
    const result = normalizeBulkProductDocumentImport({
      currency: 'aud',
      prices_include_tax: 'inc_tax',
      products: [{ product_name: 'Cube', product_code: ' CUBE-1 ', barcode: '001234', unit_cost: '$11.00', rrp: '24.95', tax_rate: 0.1 }],
    });

    expect(result.products).toEqual([expect.objectContaining({
      product_name: 'Cube', product_code: 'CUBE-1', barcode: '001234', unit_cost: 10, rrp: 24.95,
    })]);
  });

  it('keeps missing identifiers blank and tolerates malformed AI fields', () => {
    const result = normalizeBulkProductDocumentImport({
      products: [{ name: 'Uncoded product', tags: 'new, seasonal', cost: 'not money' }, null, 'bad row'],
    });

    expect(result.products).toEqual([expect.objectContaining({
      product_name: 'Uncoded product', product_code: '', barcode: '', tags: 'new, seasonal', unit_cost: null,
    })]);
  });

  it('skips non-product lines and keeps one row for every product line', () => {
    const row = { product_name: 'Widget', sku: 'W-1', cost: 5 };
    const result = normalizeBulkProductDocumentImport({
      products: [row, { ...row }, { line_type: 'freight', product_name: 'Shipping', cost: 10 }, { line_type: 'backorder', product_name: 'Later' }],
    });

    expect(result.products).toHaveLength(2);
    expect(result.products[0].product_code).toBe('W-1');
  });

  it('does not tax-adjust a cost when currency or tax treatment is ambiguous', () => {
    const result = normalizeBulkProductDocumentImport({
      currency: 'USD', prices_include_tax: 'unknown', products: [{ product_name: 'Import', unit_cost: 11 }],
    });

    expect(result.products[0].unit_cost).toBe(11);
  });
});
