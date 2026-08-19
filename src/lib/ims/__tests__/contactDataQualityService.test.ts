import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mockImsQuery,
  getIMSPool: vi.fn(),
}));

import { isContactMergePairAllowed, listDuplicateContactCandidates } from '../contactDataQualityService';

describe('contact data quality service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsQuery.mockResolvedValue([]);
  });

  it('scans active leads and customer-capable contacts but not supplier-only contacts', async () => {
    await listDuplicateContactCandidates('business-1');

    expect(mockImsQuery).toHaveBeenCalledWith(
      expect.stringContaining("c.type IN ('lead','retail_customer','b2b_customer','both')"),
      ['business-1'],
    );
  });

  it('allows only lead-to-lead or customer-to-customer merge pairs', () => {
    expect(isContactMergePairAllowed('lead', 'lead')).toBe(true);
    expect(isContactMergePairAllowed('retail_customer', 'both')).toBe(true);
    expect(isContactMergePairAllowed('b2b_customer', 'retail_customer')).toBe(true);
    expect(isContactMergePairAllowed('lead', 'retail_customer')).toBe(false);
    expect(isContactMergePairAllowed('both', 'lead')).toBe(false);
    expect(isContactMergePairAllowed('supplier', 'supplier')).toBe(false);
  });
});
