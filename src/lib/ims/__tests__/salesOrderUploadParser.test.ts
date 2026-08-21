import { describe, expect, it } from 'vitest';

import {
  matchSalesOrderCustomer,
  matchSalesOrderVariant,
  normalizeSalesOrderUpload,
} from '../salesOrderUploadParser';

describe('normalizeSalesOrderUpload', () => {
  it('keeps demand fields while discarding document prices and malformed lines', () => {
    const normalized = normalizeSalesOrderUpload({
      customer_name: 'Example Retailer',
      customer_po_number: 'PO-100',
      order_date: '2026-08-20',
      notes: ['Leave at rear dock', 'Call before delivery'],
      delivery_address: { address_line1: '1 High St', postal_code: 3000 },
      line_items: [
        { sku: '000123', barcode: '009900', description: 'Blue Shirt', quantity: '2.5', unit_price: 0.01, line_total: 0.025 },
        { sku: 'BAD', description: 'Invalid quantity', quantity: 0, unit_price: 999 },
      ],
    });

    expect(normalized).toMatchObject({
      customer_name: 'Example Retailer',
      customer_po_number: 'PO-100',
      order_date: '2026-08-20',
      notes: 'Leave at rear dock\nCall before delivery',
      delivery_address: { address: '1 High St', postcode: '3000' },
    });
    expect(normalized.line_items).toEqual([{
      product_code: '000123',
      barcode: '009900',
      product_name: 'Blue Shirt',
      variant_description: null,
      qty: 2.5,
    }]);
    expect(normalized.line_items[0]).not.toHaveProperty('unit_price');
    expect(normalized.line_items[0]).not.toHaveProperty('line_total');
  });

  it('coerces invalid AI shapes without throwing', () => {
    expect(normalizeSalesOrderUpload({ notes: { unexpected: true }, line_items: 'not-an-array' })).toMatchObject({
      notes: null,
      line_items: [],
    });
  });
});

describe('sales order upload matching', () => {
  const variants = [
    { variant_id: 'v1', sku: 'SKU-1', barcode: '000111', product_name: 'Classic Tee', variant_label: 'Blue / M' },
    { variant_id: 'v2', sku: 'SKU-2', barcode: '000222', product_name: 'Classic Tee', variant_label: 'Blue / L' },
  ];

  it('prioritizes exact SKU and barcode matches', () => {
    expect(matchSalesOrderVariant({ product_code: 'sku-1', barcode: null, product_name: '', variant_description: null, qty: 1 }, variants)?.variant_id).toBe('v1');
    expect(matchSalesOrderVariant({ product_code: null, barcode: '000222', product_name: '', variant_description: null, qty: 1 }, variants)?.variant_id).toBe('v2');
  });

  it('rejects ambiguous product name matches', () => {
    expect(matchSalesOrderVariant({ product_code: null, barcode: null, product_name: 'Classic Tee', variant_description: null, qty: 1 }, variants)).toBeNull();
  });

  it('suggests only a unique existing customer', () => {
    const customers = [
      { id: 1, name: 'Smith Stores', email: 'orders@smith.test' },
      { id: 2, name: 'Smith Stores South', email: 'south@smith.test' },
    ];
    expect(matchSalesOrderCustomer({ customer_name: 'Smith Stores', customer_email: null, customer_phone: null }, customers)?.id).toBe(1);
    expect(matchSalesOrderCustomer({ customer_name: 'Smith', customer_email: null, customer_phone: null }, customers)).toBeNull();
  });
});