import { describe, expect, it } from 'vitest';

import { normalizeParsedInvoice } from '../invoiceImportParser';

describe('normalizeParsedInvoice', () => {
  it('preserves barcode, RRP, and header discount from the parsed invoice', () => {
    const normalized = normalizeParsedInvoice({
      supplier_name: 'Acme Supplies',
      invoice_number: 'INV-1001',
      invoice_date: '2026-07-28',
      currency: 'AUD',
      prices_include_tax: 'ex_tax',
      subtotal: 100,
      tax_total: 10,
      total_amount: 110,
      discount_total: 5.5,
      line_items: [
        {
          product_code: 'SKU-1',
          barcode: '123456789',
          product_name: 'Widget',
          qty: 2,
          unit_price: 10,
          rrp: 15,
          discount_pct: 0,
          line_total: 20,
          tax_rate: 0.1,
        },
      ],
    });

    expect(normalized.discount_total).toBe(5.5);
    expect(normalized.line_items[0]).toMatchObject({
      barcode: '123456789',
      rrp: 15,
      product_code: 'SKU-1',
      qty: 2,
    });
  });
});
