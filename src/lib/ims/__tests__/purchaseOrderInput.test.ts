import { describe, expect, it } from 'vitest';

import {
  convertCin7BaseAmountToForeign,
  normalizeCin7PurchaseOrderMetadata,
  normalizePurchaseOrderField,
} from '../purchaseOrderInput';

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
      exchangeRate: 1 / 1.55,
      taxTreatment: 'no_tax',
      paymentTerms: '30 Days',
      supplierInvoiceNumber: 'INV-1002',
      supplierInvoiceDate: '2025-01-12',
    });
  });

  it('converts Cin7 foreign-per-AUD rates to AUD-per-foreign rates', () => {
    const res = normalizeCin7PurchaseOrderMetadata({
      currencyCode: 'USD',
      exchangeRate: '0.7005',
    });
    expect(res.currencyCode).toBe('USD');
    expect(res.exchangeRate).toBeCloseTo(1 / 0.7005, 6);
  });

  it('converts PO-908264 base AUD amounts back to supplier USD', () => {
    const usdTotal = convertCin7BaseAmountToForeign(34905.03, 'USD', 0.700501);
    const audPerUsd = normalizeCin7PurchaseOrderMetadata({
      currencyCode: 'USD',
      exchangeRate: 0.700501,
    }).exchangeRate;

    expect(usdTotal).toBeCloseTo(24451.01, 2);
    expect(usdTotal * audPerUsd).toBeCloseTo(34905.03, 2);
  });

  it('supports Cin7 currencies whose foreign-per-AUD rate is above one', () => {
    const jpyTotal = convertCin7BaseAmountToForeign(44646.02, 'JPY', 99.84975);
    const audPerJpy = normalizeCin7PurchaseOrderMetadata({
      currencyCode: 'JPY',
      exchangeRate: 99.84975,
    }).exchangeRate;

    expect(jpyTotal).toBeCloseTo(4457893.94, 2);
    expect(jpyTotal * audPerJpy).toBeCloseTo(44646.02, 2);
  });

  it('falls back to safe defaults when Cin7 values are missing', () => {
    expect(normalizeCin7PurchaseOrderMetadata({})).toMatchObject({
      currencyCode: 'AUD',
      exchangeRate: 1,
      taxTreatment: null,
      paymentTerms: null,
      supplierInvoiceNumber: null,
      supplierInvoiceDate: null,
    });
  });
});