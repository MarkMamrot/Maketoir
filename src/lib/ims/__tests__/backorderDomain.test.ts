import { describe, expect, it } from 'vitest';
import {
  calculateBackorderSplit,
  commercialLineKey,
  getBackorderMergeConflict,
  isOrderXeroEligible,
  nextBackorderNumber,
} from '../backorders/domain';

describe('backorder domain', () => {
  it('conserves decimal quantities when splitting actual and outstanding stock', () => {
    expect(calculateBackorderSplit(3.3333, 1.1111)).toEqual({
      orderedQty: 3.3333,
      actualQty: 1.1111,
      backorderQty: 2.2222,
    });
  });

  it('rejects invalid actual quantities', () => {
    expect(() => calculateBackorderSplit(2, -1)).toThrow('cannot be negative');
    expect(() => calculateBackorderSplit(2, 3)).toThrow('cannot exceed');
  });

  it('generates the next case-insensitive backorder suffix', () => {
    expect(nextBackorderNumber('SO-2026-0042', [
      'SO-2026-0042-B',
      'so-2026-0042-b2',
    ])).toBe('SO-2026-0042-B3');
  });

  it('groups only commercially identical lines', () => {
    const base = commercialLineKey({
      variantId: 'variant-1',
      unitAmount: 12.5,
      discountPct: 10,
      taxRate: 0.1,
      notes: 'Red',
    });
    expect(commercialLineKey({
      variantId: 'variant-1',
      unitAmount: 12.5,
      discountPct: 10,
      taxRate: 0.1,
      notes: 'Red',
    })).toBe(base);
    expect(commercialLineKey({
      variantId: 'variant-1',
      unitAmount: 12.5,
      discountPct: 5,
      taxRate: 0.1,
      notes: 'Red',
    })).not.toBe(base);
  });

  it('allows only documents with matching merge fields', () => {
    const target = {
      businessId: 'business-1',
      contactId: 12,
      locationId: 4,
      currencyCode: 'aud',
      exchangeRate: 1,
      taxTreatment: 'inc_tax',
      taxCode: 'OUTPUT',
      paymentTerms: 'Net 30',
      priceTier: 'wholesale',
      externalReference: 'PO-99',
    };
    expect(getBackorderMergeConflict(target, { ...target, currencyCode: 'AUD' })).toBeNull();
    expect(getBackorderMergeConflict(target, { ...target, locationId: 5 })).toBe('location does not match.');
    expect(getBackorderMergeConflict(target, { ...target, exchangeRate: 0.7 })).toBe('exchange rate does not match.');
    expect(getBackorderMergeConflict(target, { ...target, taxCode: 'GST FREE' })).toBe('tax code does not match.');
  });

  it('holds backorders out of Xero', () => {
    expect(isOrderXeroEligible('backordered')).toBe(false);
    expect(isOrderXeroEligible('confirmed')).toBe(true);
    expect(isOrderXeroEligible('complete')).toBe(true);
  });
});