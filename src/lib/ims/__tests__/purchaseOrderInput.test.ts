import { describe, expect, it } from 'vitest';

import { normalizeCin7PurchaseOrderMetadata, normalizePurchaseOrderField } from '../purchaseOrderInput';

describe('normalizePurchaseOrderField', () => {
  it('turns blank optional dates into null', () => {
    expect(normalizePurchaseOrderField('expected_date', '')).toBeNull();
    expect(normalizePurchaseOrderField('supplier_invoice_date', '  ')).toBeNull();
  });

  it('turns blank or null freight and discount into zero', () => {
    expect(normalizePurchaseOrderField('freight', '')).toBe(0);
    expect(normalizePurchaseOrderField('freight', null)).toBe(0);
    expect(normalizePurchaseOrderField('discount', '')).toBe(0);
  });

  it('preserves populated values', () => {
    expect(normalizePurchaseOrderField('expected_date', '2026-08-10')).toBe('2026-08-10');
    expect(normalizePurchaseOrderField('discount', 12.5)).toBe(12.5);
  });
});

describe('normalizeCin7PurchaseOrderMetadata', () => {
  it('normalizes historical Cin7 PO metadata and currency fields', () => {
    expect(normalizeCin7PurchaseOrderMetadata({
      currencyCode: 'usd',
      exchangeRate: '1.55',
      paymentTerms: '30 Days',
      supplierInvoiceNumber: 'INV-1002',
      supplierInvoiceDate: '2025-01-12T00:00:00Z',
      invoiceDate: '2025-01-11',
    })).toMatchObject({
      currencyCode: 'USD',
      exchangeRate: 1.55,
      paymentTerms: '30 Days',
      supplierInvoiceNumber: 'INV-1002',
      supplierInvoiceDate: '2025-01-12',
    });
  });

  it('canonicalizes inverse FX rates for imported foreign-currency POs', () => {
    const res = normalizeCin7PurchaseOrderMetadata({
      currencyCode: 'USD',
      exchangeRate: '0.7005',
    });
    expect(res.currencyCode).toBe('USD');
    expect(res.exchangeRate).toBeCloseTo(1 / 0.7005, 6);
  });

  it('falls back to safe defaults when Cin7 values are missing', () => {
    expect(normalizeCin7PurchaseOrderMetadata({})).toMatchObject({
      currencyCode: 'AUD',
      exchangeRate: 1,
      paymentTerms: null,
      supplierInvoiceNumber: null,
      supplierInvoiceDate: null,
    });
  });
});