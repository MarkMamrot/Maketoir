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

  it('treats itemised subtotals as tax-inclusive when Shopify omits refund transactions', () => {
    const result = parseShopifyRefund({
      id: 1,
      refund_line_items: [{
        quantity: 1,
        subtotal: '149.95',
        total_tax: '13.63',
        restock_type: 'no_restock',
        line_item: { variant_id: 10, title: 'Item' },
      }],
    }, 'shopify_payments');

    expect(result).toMatchObject({ amount: 149.95, taxAmount: 13.63, gateway: 'shopify_payments' });
    expect(result.restockLines[0]).toMatchObject({ unitPrice: 136.32, restock: false });
  });

  it('extracts GST from a shipping-only refund adjustment', () => {
    const result = parseShopifyRefund({
      id: 1,
      transactions: [{ kind: 'refund', status: 'success', amount: '12.95', gateway: 'shopify_payments' }],
      refund_line_items: [],
      order_adjustments: [{ kind: 'shipping_refund', amount: '-12.95', tax_amount: '-1.18' }],
    });

    expect(result).toMatchObject({ amount: 12.95, taxAmount: 1.18, gateway: 'shopify_payments' });
    expect(result.restockLines).toEqual([expect.objectContaining({
      shopifyVariantId: '',
      quantity: 1,
      restock: false,
      unitPrice: 11.77,
      taxAmount: 1.18,
      name: 'Shipping refund',
    })]);
  });

  it('includes shipping adjustments when refund transactions are omitted', () => {
    const result = parseShopifyRefund({
      id: 1,
      refund_line_items: [{
        quantity: 1,
        subtotal: '7.99',
        total_tax: '0.73',
        restock_type: 'cancel',
        line_item: { variant_id: 10, title: 'Item' },
      }],
      order_adjustments: [{ kind: 'shipping_refund', amount: '-19.95', tax_amount: '-1.81' }],
    }, 'shopify_payments');

    expect(result).toMatchObject({ amount: 27.94, taxAmount: 2.54, gateway: 'shopify_payments' });
    expect(result.restockLines[0]).toMatchObject({ unitPrice: 7.26, restock: true });
    expect(result.restockLines[1]).toMatchObject({ unitPrice: 18.14, taxAmount: 1.81, restock: false, name: 'Shipping refund' });
  });
});