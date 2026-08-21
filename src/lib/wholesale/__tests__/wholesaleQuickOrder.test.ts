import { describe, expect, it } from 'vitest';
import { buildWholesaleQuickOrder, buildWholesaleQuickOrderTemplate } from '../wholesaleQuickOrder';

const product = {
  product_id: 'product-1',
  name: 'Current Raincoat',
  allow_indent_wholesale: 0,
  variants: [{
    variant_id: 'variant-1', product_id: 'product-1', sku: 'RAIN-GRN-M', barcode: '930000000001',
    option1_value: 'Green', option2_value: 'Medium', option3_value: null,
    price_wholesale: 52, available: 5,
  }],
};

describe('buildWholesaleQuickOrder', () => {
  it('matches approved SKUs and barcodes and applies current catalogue pricing', () => {
    const result = buildWholesaleQuickOrder('RAIN-GRN-M, 2\n930000000001\t1', [product]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      product_name: 'Current Raincoat', variant_label: 'Green / Medium', qty: 3, unit_price: 52,
    });
    expect(result.issues).toHaveLength(0);
  });

  it('caps additions using live stock minus the quantity already in cart', () => {
    const result = buildWholesaleQuickOrder('RAIN-GRN-M 4', [product], { 'variant-1': 3 });

    expect(result.items[0]).toMatchObject({ qty: 2, indent_qty: 0, is_indent: false });
    expect(result.adjustedLines).toBe(1);
  });

  it('keeps requested quantities and calculates final indent quantity when indent is enabled', () => {
    const result = buildWholesaleQuickOrder(
      'RAIN-GRN-M; 4',
      [{ ...product, allow_indent_wholesale: 1, variants: [{ ...product.variants[0], available: 2 }] }],
      { 'variant-1': 1 },
    );

    expect(result.items[0]).toMatchObject({ qty: 4, indent_qty: 3, is_indent: true, allow_indent: true });
  });

  it('rejects a non-indent line when existing cart quantity consumes all live stock', () => {
    const result = buildWholesaleQuickOrder('RAIN-GRN-M, 1', [product], { 'variant-1': 5 });

    expect(result.items).toHaveLength(0);
    expect(result.issues[0].reason).toBe('No additional stock is available.');
  });

  it('does not treat an identical SKU and barcode on one variant as ambiguous', () => {
    const sameIdentifier = { ...product, variants: [{ ...product.variants[0], barcode: 'RAIN-GRN-M' }] };
    const result = buildWholesaleQuickOrder('RAIN-GRN-M, 1', [sameIdentifier]);

    expect(result.items).toHaveLength(1);
    expect(result.issues).toHaveLength(0);
  });

  it('reports invalid, unknown, ambiguous, and unavailable lines without adding them', () => {
    const duplicate = { ...product, product_id: 'product-2', variants: [{ ...product.variants[0], variant_id: 'variant-2', product_id: 'product-2' }] };
    const result = buildWholesaleQuickOrder('BAD\nUNKNOWN, 2\nRAIN-GRN-M, 1\n930000000001, 1', [product, duplicate], { 'variant-1': 5 });

    expect(result.items).toHaveLength(0);
    expect(result.issues.map(issue => issue.reason)).toEqual([
      'Use SKU or barcode followed by a whole quantity.',
      'Not found in your approved catalogue.',
      'Matches more than one approved variant.',
      'Matches more than one approved variant.',
    ]);
  });

  it('accepts a header row', () => {
    const result = buildWholesaleQuickOrder('SKU, Quantity\nRAIN-GRN-M, 1', [product]);

    expect(result.items[0].qty).toBe(1);
    expect(result.issues).toHaveLength(0);
  });

  it('accepts a generated template while ignoring variants with blank quantities', () => {
    const result = buildWholesaleQuickOrder('SKU,Quantity\nRAIN-GRN-M,\n930000000001,2', [product]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].qty).toBe(2);
    expect(result.issues).toHaveLength(0);
  });

  it('parses quoted CSV identifiers', () => {
    const quotedProduct = { ...product, variants: [{ ...product.variants[0], sku: 'RAIN,"GREEN"' }] };
    const result = buildWholesaleQuickOrder('SKU,Quantity\n"RAIN,""GREEN""",2', [quotedProduct]);

    expect(result.items[0].qty).toBe(2);
    expect(result.issues).toHaveLength(0);
  });

  it('builds a sorted, quote-safe catalogue template without prices or stock', () => {
    const template = buildWholesaleQuickOrderTemplate([
      { ...product, variants: [{ ...product.variants[0], sku: 'Z-SKU' }, { ...product.variants[0], variant_id: 'variant-2', sku: 'A,SKU' }] },
    ]);

    expect(template).toBe('SKU,Quantity\r\n"A,SKU",\r\nZ-SKU,');
    expect(template).not.toContain('52');
  });
});