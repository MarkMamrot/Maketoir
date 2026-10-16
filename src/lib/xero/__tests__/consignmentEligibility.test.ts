import { beforeEach, describe, expect, it, vi } from 'vitest';

const { imsQuery, reportIssue } = vi.hoisted(() => ({ imsQuery: vi.fn(), reportIssue: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: reportIssue }));
import { assertOwnedSupplierCredit, isConsignmentPurchase, isConsignmentSnapshot } from '../consignmentEligibility';

describe('immutable consignment accounting eligibility', () => {
  beforeEach(() => { vi.clearAllMocks(); reportIssue.mockResolvedValue(undefined); });

  it.each([null, undefined])('treats a legacy %s snapshot as owned', value => {
    expect(isConsignmentSnapshot({ consignment_supplier_id: value })).toBe(false);
  });

  it.each(['purchase_order', 'supplier_credit_note'] as const)('loads the persisted %s snapshot within the tenant', async type => {
    imsQuery.mockResolvedValue([{ consignment_supplier_id: 7 }]);
    expect(await isConsignmentPurchase('business-1', type, 42)).toBe(true);
    const [sql, params] = imsQuery.mock.calls[0];
    expect(sql).toContain('consignment_supplier_id');
    expect(sql).toContain('business_id = ?');
    expect(sql).not.toContain('ims_contacts');
    expect(params).toEqual([42, 'business-1']);
  });

  it('does not reclassify an old owned purchase from the current supplier setting', async () => {
    imsQuery.mockResolvedValue([{ consignment_supplier_id: null, is_consignment_supplier: 1 }]);
    expect(await isConsignmentPurchase('business-1', 'purchase_order', 42)).toBe(false);
  });

  it('blocks consignment supplier-credit settlement by its stored Xero identity', async () => {
    imsQuery.mockResolvedValue([{ consignment_supplier_id: 7 }]);
    await expect(assertOwnedSupplierCredit('business-1', 'credit-1')).rejects.toThrow('intentionally excluded');
    expect(imsQuery.mock.calls[0][1]).toEqual(['credit-1', 'business-1']);
  });

  it('leaves customer credit accounting eligible', async () => {
    imsQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 7 }]);
    await expect(assertOwnedSupplierCredit('business-1', 'customer-credit')).resolves.toBeUndefined();
  });
  it.each(['purchase_order', 'supplier_credit_note'] as const)('fails closed and records a visible issue for a missing persisted %s', async type => {
    imsQuery.mockResolvedValue([]);
    await expect(isConsignmentPurchase('business-1', type, 42)).rejects.toThrow('ownership could not be verified');
    expect(reportIssue).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1',
      operation: 'verify_persisted_ownership', reference: { type, id: 42 } }));
  });
  it.each([{ id: 42 }, { consignment_supplier_id: undefined }])('does not treat incomplete persisted snapshot %j as legacy owned', async row => {
    imsQuery.mockResolvedValue([row]);
    await expect(isConsignmentPurchase('business-1', 'purchase_order', 42)).rejects.toThrow('ownership could not be verified');
  });
  it('fails closed when a credit Xero identity matches neither persisted supplier nor customer credit', async () => {
    imsQuery.mockResolvedValue([]);
    await expect(assertOwnedSupplierCredit('business-1', 'missing-credit')).rejects.toThrow('ownership could not be verified');
    expect(reportIssue).toHaveBeenCalled();
  });
});
