import { describe, expect, it } from 'vitest';
import { buildEarlyPaymentDiscountOrderPreview, buildEarlyPaymentDiscountSnapshot, calculateEarlyPaymentDiscount, previewPersistedEarlyPaymentDiscountOrder } from '../earlyPaymentDiscount';

const baseInput = {
  documentDate: '2026-09-01',
  discountDays: 10,
  discountBasisPoints: 500,
  taxableMerchandiseNetCents: 10_000,
  taxableMerchandiseTaxCents: 1_000,
  taxFreeMerchandiseCents: 2_000,
  documentTotalCents: 15_000,
  payments: [],
};

describe('calculateEarlyPaymentDiscount', () => {
  it('requires cumulative full settlement by the inclusive cutoff', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      payments: [
        { paymentDate: '2026-09-05', amountCents: 8_000 },
        { paymentDate: '2026-09-11', amountCents: 6_350 },
      ],
    });

    expect(result).toEqual({
      cutoffDate: '2026-09-11',
      taxableDiscountNetCents: 500,
      taxFreeDiscountCents: 100,
      discountNetCents: 600,
      discountTaxCents: 50,
      discountGrossCents: 650,
      discountedSettlementCents: 14_350,
      paidByCutoffCents: 14_350,
      eligible: true,
    });
  });

  it('does not count a settlement payment made after the cutoff', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      payments: [
        { paymentDate: '2026-09-10', amountCents: 8_000 },
        { paymentDate: '2026-09-12', amountCents: 6_350 },
      ],
    });

    expect(result.paidByCutoffCents).toBe(8_000);
    expect(result.eligible).toBe(false);
  });

  it('excludes freight because only merchandise buckets form the discount base', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      taxableMerchandiseNetCents: 10_000,
      taxableMerchandiseTaxCents: 1_000,
      taxFreeMerchandiseCents: 0,
      documentTotalCents: 13_200,
      payments: [{ paymentDate: '2026-09-11', amountCents: 12_650 }],
    });

    expect(result.discountGrossCents).toBe(550);
    expect(result.discountedSettlementCents).toBe(12_650);
    expect(result.eligible).toBe(true);
  });

  it('uses the already-discounted merchandise amounts supplied by the caller', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      taxableMerchandiseNetCents: 9_000,
      taxableMerchandiseTaxCents: 900,
      taxFreeMerchandiseCents: 0,
      documentTotalCents: 9_900,
      payments: [{ paymentDate: '2026-09-01', amountCents: 9_405 }],
    });

    expect(result.discountNetCents).toBe(450);
    expect(result.discountTaxCents).toBe(45);
    expect(result.eligible).toBe(true);
  });

  it('rounds each net and tax component to currency cents', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      discountBasisPoints: 333,
      taxableMerchandiseNetCents: 101,
      taxableMerchandiseTaxCents: 10,
      taxFreeMerchandiseCents: 101,
      documentTotalCents: 212,
      payments: [{ paymentDate: '2026-09-01', amountCents: 204 }],
    });

    expect(result.taxableDiscountNetCents).toBe(3);
    expect(result.taxFreeDiscountCents).toBe(3);
    expect(result.discountNetCents).toBe(6);
    expect(result.discountTaxCents).toBe(0);
    expect(result.discountedSettlementCents).toBe(206);
    expect(result.eligible).toBe(false);
  });

  it('uses identical integer-currency behavior for foreign-currency documents', () => {
    const result = calculateEarlyPaymentDiscount({
      ...baseInput,
      taxableMerchandiseNetCents: 20_000,
      taxableMerchandiseTaxCents: 0,
      taxFreeMerchandiseCents: 0,
      documentTotalCents: 21_500,
      payments: [{ paymentDate: '2026-09-11', amountCents: 20_500 }],
    });

    expect(result.discountGrossCents).toBe(1_000);
    expect(result.eligible).toBe(true);
  });

  it('rejects invalid percentages, amounts, and dates', () => {
    expect(() => calculateEarlyPaymentDiscount({ ...baseInput, discountBasisPoints: 10_001 })).toThrow();
    expect(() => calculateEarlyPaymentDiscount({ ...baseInput, documentTotalCents: 1.5 })).toThrow();
    expect(() => calculateEarlyPaymentDiscount({ ...baseInput, documentDate: '2026-02-30' })).toThrow();
  });
});

describe('buildEarlyPaymentDiscountSnapshot', () => {
  const rule = {
    id: 7,
    name: '5% within 10 days',
    discountBasisPoints: 500,
    discountDays: 10,
    discountBase: 'merchandise' as const,
    dateBasis: 'invoice_date_order_fallback' as const,
  };

  it('uses a PO supplier invoice date when available', () => {
    expect(buildEarlyPaymentDiscountSnapshot({
      rule,
      documentType: 'purchase_order',
      orderDate: '2026-09-01',
      supplierInvoiceDate: '2026-09-04',
      source: 'contact_default',
    }).cutoffDate).toBe('2026-09-14');
  });

  it('falls back to order date for a PO and always uses it for an SO', () => {
    expect(buildEarlyPaymentDiscountSnapshot({
      rule,
      documentType: 'purchase_order',
      orderDate: '2026-09-01',
      source: 'order_override',
    }).cutoffDate).toBe('2026-09-11');

    expect(buildEarlyPaymentDiscountSnapshot({
      rule,
      documentType: 'sales_order',
      orderDate: '2026-09-01',
      supplierInvoiceDate: '2026-09-20',
      source: 'contact_default',
    }).cutoffDate).toBe('2026-09-11');
  });

  it('returns an independent primitive snapshot of the rule', () => {
    const snapshot = buildEarlyPaymentDiscountSnapshot({
      rule,
      documentType: 'sales_order',
      orderDate: '2026-09-01',
      source: 'contact_default',
    });
    const changedRule = { ...rule, name: 'Changed later', discountBasisPoints: 250 };

    expect(changedRule.discountBasisPoints).toBe(250);
    expect(snapshot.name).toBe('5% within 10 days');
    expect(snapshot.discountBasisPoints).toBe(500);
  });
});

describe('buildEarlyPaymentDiscountOrderPreview', () => {
  const previewInput = {
    cutoffDate: '2026-09-11',
    discountDays: 10,
    discountBasisPoints: 500,
    taxTreatment: 'ex_tax' as const,
    orderDiscount: 10,
    documentTotal: 170,
    items: [
      { lineTotal: 100, taxRate: 0.1 },
      { lineTotal: 50, taxRate: 0 },
    ],
    payments: [{ paymentDate: '2026-09-05', amount: 100 }],
  };

  it('excludes freight and allocates an existing order discount across merchandise', () => {
    const result = buildEarlyPaymentDiscountOrderPreview({
      ...previewInput,
      proposedPayment: { paymentDate: '2026-09-11', amount: 62.5 },
    });

    expect(result.discountGrossCents).toBe(750);
    expect(result.discountedSettlementCents).toBe(16_250);
    expect(result.paidByCutoffCents).toBe(16_250);
    expect(result.remainingSettlementCents).toBe(0);
    expect(result.eligible).toBe(true);
  });

  it('does not award the discount when cumulative payment is one cent short or late', () => {
    expect(buildEarlyPaymentDiscountOrderPreview({
      ...previewInput,
      proposedPayment: { paymentDate: '2026-09-11', amount: 62.49 },
    }).eligible).toBe(false);

    expect(buildEarlyPaymentDiscountOrderPreview({
      ...previewInput,
      proposedPayment: { paymentDate: '2026-09-12', amount: 62.5 },
    }).eligible).toBe(false);
  });

  it('does not apply a discount to an overpayment', () => {
    const result = buildEarlyPaymentDiscountOrderPreview({
      ...previewInput,
      proposedPayment: { paymentDate: '2026-09-11', amount: 62.51 },
    });
    expect(result.eligible).toBe(false);
    expect(result.excessSettlementCents).toBe(1);
  });

  it('uses only the persisted order snapshot, items, and payments', () => {
    const result = previewPersistedEarlyPaymentDiscountOrder({
      early_payment_discount_name: '5% in 10 days',
      early_payment_discount_basis_points: 500,
      early_payment_discount_days: 10,
      early_payment_discount_cutoff_date: '2026-09-11',
      tax_treatment: 'inc_tax',
      discount: 0,
      total_amount: 110,
      items: [{ line_total: 110, tax_rate: 0.1 }],
      payments: [],
    }, { paymentDate: '2026-09-11', amount: 104.5 });

    expect(result).toMatchObject({ available: true, discountGrossCents: 550, eligible: true });
    expect(previewPersistedEarlyPaymentDiscountOrder({ total_amount: 110 })).toEqual({
      available: false,
      reason: 'no_early_payment_discount',
    });
  });
});