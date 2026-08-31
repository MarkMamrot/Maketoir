import { describe, expect, it } from 'vitest';
import { buildWholesaleReorderCart } from '../wholesaleReorder';

const product = {
  product_id: 'product-1',
  name: 'Current product name',
  allow_indent_wholesale: 0,
  variants: [{
    variant_id: 'variant-1',
    product_id: 'product-1',
    sku: 'CURRENT-SKU',
    option1_value: 'Green',
    option2_value: 'Medium',
    option3_value: null,
    price_wholesale: 52,
    available: 10,
  }],
};

describe('buildWholesaleReorderCart', () => {
  it('uses current catalogue identity and pricing', () => {
    const result = buildWholesaleReorderCart([{ variant_id: 'variant-1', qty_ordered: 2 }], [product]);

    expect(result.items[0]).toMatchObject({
      product_name: 'Current product name',
      variant_label: 'Green / Medium',
      sku: 'CURRENT-SKU',
      qty: 2,
      unit_price: 52,
    });
  });

  it('caps non-indent quantities to current stock', () => {
    const result = buildWholesaleReorderCart(
      [{ variant_id: 'variant-1', qty_ordered: 4 }],
      [{ ...product, variants: [{ ...product.variants[0], available: 1 }] }],
    );

    expect(result.items[0]).toMatchObject({ qty: 1, indent_qty: 0, is_indent: false });
    expect(result.adjustedLines).toBe(1);
  });

  it('preserves requested quantity when current indent ordering is enabled', () => {
    const result = buildWholesaleReorderCart(
      [{ variant_id: 'variant-1', qty_ordered: 4 }],
      [{ ...product, allow_indent_wholesale: 1, variants: [{ ...product.variants[0], available: 1 }] }],
    );

    expect(result.items[0]).toMatchObject({ qty: 4, indent_qty: 3, is_indent: true, allow_indent: true });
    expect(result.adjustedLines).toBe(0);
  });

  it('preserves requested quantity for an untracked product without indent', () => {
    const result = buildWholesaleReorderCart(
      [{ variant_id: 'variant-1', qty_ordered: 40 }],
      [{ ...product, is_stock_item: 0, variants: [{ ...product.variants[0], available: 0 }] }],
    );

    expect(result.items[0]).toMatchObject({ qty: 40, tracks_inventory: false, allow_indent: false, is_indent: false, indent_qty: 0 });
  });

  it('omits retired variants and out-of-stock non-indent variants', () => {
    const result = buildWholesaleReorderCart(
      [{ variant_id: 'retired', qty_ordered: 2 }, { variant_id: 'variant-1', qty_ordered: 1 }],
      [{ ...product, variants: [{ ...product.variants[0], available: 0 }] }],
    );

    expect(result.items).toHaveLength(0);
    expect(result.unavailableLines).toBe(2);
  });
});