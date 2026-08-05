import { describe, expect, it } from 'vitest';

import { normalizePurchaseOrderField } from '../purchaseOrderInput';

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