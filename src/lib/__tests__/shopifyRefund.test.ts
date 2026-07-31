import { describe, expect, it } from 'vitest';

import { parseShopifyRefund } from '../shopifyRefund';

describe('parseShopifyRefund', () => {
  it('uses successful refund transactions as the authoritative amount', () => {
    const result = parseShopifyRefund({
      id: 1,
      transactions: [{ kind: 'refund', status: 'success', amount: '12.95', gateway: 'shopify_payments' }],
      refund_line_items: [{ quantity: 1, subtotal: '11.77', total_tax: '1.18', line_item: { variant_id: 10 } }],
    });

    expect(result).toMatchObject({ amount: 12.95, taxAmount: 1.18, gateway: 'shopify_payments' });
  });

  it('falls back to itemised subtotal plus tax when Shopify omits refund transactions', () => {
    const result = parseShopifyRefund({
      id: 1,
      refund_line_items: [{
        quantity: 1,
        subtotal: '11.77',
        total_tax: '1.18',
        restock_type: 'no_restock',
        line_item: { variant_id: 10, title: 'Item' },
      }],
    }, 'shopify_payments');

    expect(result).toMatchObject({ amount: 12.95, taxAmount: 1.18, gateway: 'shopify_payments' });
    expect(result.restockLines[0]).toMatchObject({ unitPrice: 11.77, restock: false });
  });

  it('extracts GST from a shipping-only refund adjustment', () => {
    const result = parseShopifyRefund({
      id: 1,
      transactions: [{ kind: 'refund', status: 'success', amount: '12.95', gateway: 'shopify_payments' }],
      refund_line_items: [],
      order_adjustments: [{ kind: 'shipping_refund', amount: '-11.77', tax_amount: '-1.18' }],
    });

    expect(result).toMatchObject({ amount: 12.95, taxAmount: 1.18, gateway: 'shopify_payments' });
    expect(result.restockLines).toEqual([]);
  });
});