import { describe, expect, it } from 'vitest';

import { calculateTaxInclusiveRrp, deriveInvoicePoLine, invoiceUnitPriceToProductCost, normalizeParsedInvoice } from '../invoiceImportParser';

describe('calculateTaxInclusiveRrp', () => {
  it('applies markup before sales tax and rounds to cents', () => {
    expect(calculateTaxInclusiveRrp(10, 100, 0.1)).toBe(22);
    expect(calculateTaxInclusiveRrp(12.34, 50, 0.1)).toBe(20.36);
  });

  it('extracts included tax from invoice cost before markup', () => {
    const cost = invoiceUnitPriceToProductCost(11, 'inc_tax', 0.1);
    expect(cost).toBe(10);
    expect(calculateTaxInclusiveRrp(cost, 100, 0.1)).toBe(22);
    expect(invoiceUnitPriceToProductCost(10, 'ex_tax', 0.1)).toBe(10);
  });
});

describe('deriveInvoicePoLine', () => {
  it('makes the printed subtotal authoritative and derives cost to four decimals', () => {
    expect(deriveInvoicePoLine(10, 61.38, 6.82)).toEqual({ unitCost: 6.138, lineTotal: 61.38 });
    expect(deriveInvoicePoLine(12, 61.34, 5.68)).toEqual({ unitCost: 5.1117, lineTotal: 61.34 });
  });
});

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
          product_type: 'Apparel',
          brand: 'Acme',
        },
      ],
    });

    expect(normalized.discount_total).toBe(5.5);
    expect(normalized.line_items[0]).toMatchObject({
      barcode: '123456789',
      rrp: 15,
      product_code: 'SKU-1',
      qty: 2,
      product_type: 'Apparel',
      brand: 'Acme',
    });
  });

  it('moves freight charges out of product lines', () => {
    const normalized = normalizeParsedInvoice({
      currency: 'AUD',
      prices_include_tax: 'ex_tax',
      line_items: [
        {
          line_type: 'product',
          product_code: 'SKU-1',
          barcode: null,
          product_name: 'Widget',
          qty: 1,
          unit_price: 20,
          discount_pct: 0,
          line_total: 20,
          tax_rate: 0.1,
        },
        {
          product_code: null,
          barcode: null,
          product_name: 'Freight',
          qty: 1,
          unit_price: 12.5,
          discount_pct: 0,
          line_total: 12.5,
          tax_rate: 0.1,
        },
      ],
    });

    expect(normalized.freight_total).toBe(12.5);
    expect(normalized.line_items).toHaveLength(1);
    expect(normalized.line_items[0].product_code).toBe('SKU-1');
  });

  it('excludes products listed only in a backorder section', () => {
    const normalized = normalizeParsedInvoice({
      currency: 'AUD',
      prices_include_tax: 'ex_tax',
      line_items: [
        { line_type: 'product', product_code: 'IN-STOCK', barcode: null, product_name: 'In stock', qty: 1, unit_price: 10, discount_pct: 0, line_total: 10, tax_rate: 0.1 },
        { line_type: 'backorder', product_code: 'BACKORDER', barcode: null, product_name: 'Backordered', qty: 16, unit_price: 5.68, discount_pct: 0, line_total: 81.79, tax_rate: 0.1 },
      ],
    });

    expect(normalized.line_items.map(line => line.product_code)).toEqual(['IN-STOCK']);
  });

  it('derives net unit price from line total when discount columns are descriptive', () => {
    const normalized = normalizeParsedInvoice({
      currency: 'AUD',
      prices_include_tax: 'ex_tax',
      line_items: [
        {
          product_code: '9781923457720',
          product_name: 'Bella Grows A Bicycle',
          qty: 5,
          unit_price: 24.99,
          discount_pct: 40,
          line_total: 68.15,
          tax_rate: 0.1,
          rrp: 24.99,
        },
      ],
    });

    expect(normalized.line_items[0]).toMatchObject({
      qty: 5,
      line_total: 68.15,
      unit_price: 13.63,
      discount_pct: 0,
      rrp: 24.99,
    });
  });
});
