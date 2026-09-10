import { describe, expect, it } from 'vitest';
import { matchBulkProductSupplierId, normalizeBulkProductDocumentImport, prepareBulkProductPriceReview, resolveBulkProductSourcePrices } from '../bulkProductDocumentImport';

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

  it('preserves a generic price column for confirmation instead of guessing its meaning', () => {
    const result = normalizeBulkProductDocumentImport({
      currency: 'AUD', source_price_column: 'Price', products: [{ product_name: 'Widget', price: '$11.00' }],
    });

    expect(result.source_price_column).toBe('Price');
    expect(result.products[0]).toMatchObject({ source_price: 11, unit_cost: null, rrp: null });
  });

  it('maps a confirmed tax-inclusive AUD price to tax-exclusive product cost', () => {
    const extraction = normalizeBulkProductDocumentImport({
      currency: 'AUD', prices_include_tax: 'unknown', products: [{ product_name: 'Widget', source_price: 11 }],
    });

    const result = resolveBulkProductSourcePrices(extraction, 'cost', 'AUD', 'inc_tax');

    expect(result.products[0]).toMatchObject({ source_price: 11, unit_cost: 10, rrp: null });
  });

  it('maps a confirmed price to RRP without treating it as cost', () => {
    const extraction = normalizeBulkProductDocumentImport({
      currency: 'AUD', products: [{ product_name: 'Widget', source_price: 24.95 }],
    });

    const result = resolveBulkProductSourcePrices(extraction, 'rrp', 'AUD', 'inc_tax');

    expect(result.products[0]).toMatchObject({ unit_cost: null, rrp: 24.95 });
  });

  it('carries the invoice supplier onto lines while preserving an explicit line supplier and brand', () => {
    const result = normalizeBulkProductDocumentImport({
      supplier_name: 'Acme Supply Co',
      products: [
        { product_name: 'Acme Red Widget', brand: 'Acme' },
        { product_name: 'Other Widget', supplier_name: 'Other Supplier', brand: 'Other' },
      ],
    });

    expect(result.supplier_name).toBe('Acme Supply Co');
    expect(result.products).toEqual([
      expect.objectContaining({ supplier_name: 'Acme Supply Co', brand: 'Acme' }),
      expect.objectContaining({ supplier_name: 'Other Supplier', brand: 'Other' }),
    ]);
  });

  it('matches an extracted supplier to an existing contact without accepting a partial name', () => {
    const suppliers = [{ id: 7, name: 'Acme Supply Co.' }, { id: 8, name: 'Other Wholesale' }];

    expect(matchBulkProductSupplierId('ACME SUPPLY CO', suppliers)).toBe(7);
    expect(matchBulkProductSupplierId('Acme', suppliers)).toBe('');
  });

  it('requests currency confirmation instead of dropping an extracted cost', () => {
    const extraction = normalizeBulkProductDocumentImport({
      currency: 'UNKNOWN', prices_include_tax: 'unknown', products: [{ product_name: 'Widget', unit_cost: 11 }],
    });

    const review = prepareBulkProductPriceReview(extraction);

    expect(review).toMatchObject({ suggestedMapping: 'cost', reason: 'cost_currency' });
    expect(review?.extraction.products[0]).toMatchObject({ source_price: 11, unit_cost: null });
  });

  it('requests GST confirmation for an AUD cost with unknown tax treatment', () => {
    const extraction = normalizeBulkProductDocumentImport({
      currency: 'AUD', prices_include_tax: 'unknown', products: [{ product_name: 'Widget', unit_cost: 11 }],
    });

    expect(prepareBulkProductPriceReview(extraction)).toMatchObject({ suggestedMapping: 'cost', reason: 'cost_tax' });
  });
});
