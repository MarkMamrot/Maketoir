import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsExecute, mockImsQuery } = vi.hoisted(() => ({
  mockImsExecute: vi.fn(),
  mockImsQuery: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mockImsExecute, imsQuery: mockImsQuery }));

import { EarlyPaymentDiscountRulesRepository, normalizeEarlyPaymentDiscountRule, resolveEarlyPaymentDiscountOrderSnapshot } from '../earlyPaymentDiscountRules';

const activeRule = {
  id: 4,
  business_id: 'business-a',
  name: '2% in 10 days',
  discount_basis_points: 200,
  discount_days: 10,
  discount_base: 'merchandise' as const,
  date_basis: 'invoice_date_order_fallback' as const,
  is_active: 1,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

describe('early-payment discount rules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes a percentage into integer basis points', () => {
    expect(normalizeEarlyPaymentDiscountRule({ name: '  2.5% in 10 days  ', discountPercent: 2.5, discountDays: 10 })).toEqual({
      name: '2.5% in 10 days',
      discountBasisPoints: 250,
      discountDays: 10,
      isActive: true,
    });
  });

  it('rejects invalid percentages and day windows', () => {
    expect(() => normalizeEarlyPaymentDiscountRule({ name: 'Invalid', discountPercent: 0, discountDays: 10 })).toThrow();
    expect(() => normalizeEarlyPaymentDiscountRule({ name: 'Invalid', discountPercent: 5, discountDays: 1.5 })).toThrow();
  });

  it('always scopes reads and writes to the tenant business id', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await EarlyPaymentDiscountRulesRepository.get(4, 'business-a');
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('r.business_id = ?'), [4, 'business-a']);

    mockImsExecute.mockResolvedValueOnce({ affectedRows: 1 });
    await EarlyPaymentDiscountRulesRepository.deactivate(4, 'business-a');
    expect(mockImsExecute).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), [4, 'business-a']);
  });

  it('resolves a tenant contact default into an immutable PO snapshot', async () => {
    mockImsQuery.mockResolvedValueOnce([{ rule_id: 4 }]).mockResolvedValueOnce([activeRule]);

    const snapshot = await resolveEarlyPaymentDiscountOrderSnapshot({
      businessId: 'business-a',
      documentType: 'purchase_order',
      contactId: 12,
      orderDate: '2026-03-01',
      supplierInvoiceDate: '2026-03-05',
      selection: { mode: 'contact_default' },
    });

    expect(mockImsQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('business_id = ?'), [12, 'business-a']);
    expect(snapshot).toMatchObject({
      early_payment_discount_rule_id: 4,
      early_payment_discount_cutoff_date: '2026-03-15',
      early_payment_discount_source: 'contact_default',
    });
  });

  it('supports an explicit tenant rule override without reading the contact', async () => {
    mockImsQuery.mockResolvedValueOnce([activeRule]);

    const snapshot = await resolveEarlyPaymentDiscountOrderSnapshot({
      businessId: 'business-a',
      documentType: 'sales_order',
      contactId: 12,
      orderDate: '2026-03-01',
      selection: { mode: 'override', ruleId: 4 },
    });

    expect(mockImsQuery).toHaveBeenCalledTimes(1);
    expect(snapshot.early_payment_discount_source).toBe('order_override');
    expect(snapshot.early_payment_discount_cutoff_date).toBe('2026-03-11');
  });

  it('returns an empty snapshot for opt-out and rejects inactive rules', async () => {
    await expect(resolveEarlyPaymentDiscountOrderSnapshot({
      businessId: 'business-a',
      documentType: 'sales_order',
      orderDate: '2026-03-01',
      selection: { mode: 'none' },
    })).resolves.toMatchObject({ early_payment_discount_rule_id: null });
    expect(mockImsQuery).not.toHaveBeenCalled();

    mockImsQuery.mockResolvedValueOnce([{ ...activeRule, is_active: 0 }]);
    await expect(resolveEarlyPaymentDiscountOrderSnapshot({
      businessId: 'business-a',
      documentType: 'sales_order',
      orderDate: '2026-03-01',
      selection: { mode: 'override', ruleId: 4 },
    })).rejects.toThrow('not active');
  });
});