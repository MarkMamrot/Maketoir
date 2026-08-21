import { beforeEach, describe, expect, it, vi } from 'vitest';

const { imsQuery, runImsForBusiness } = vi.hoisted(() => ({
  imsQuery: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery }));

import { findWholesaleBuyerByEmail, getActiveWholesaleBuyer } from '../wholesaleIdentity';

describe('wholesale buyer identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up an eligible buyer only inside the resolved supplier tenant', async () => {
    imsQuery
      .mockResolvedValueOnce([{ value: 'yes' }])
      .mockResolvedValueOnce([{
        id: 42,
        email: 'Buyer@Example.com',
        name: ' Buyer ',
        company: ' Example Co ',
        type: 'b2b_customer',
        price_tier: 'wholesale',
        is_active: 1,
      }]);

    await expect(findWholesaleBuyerByEmail('biz-1', ' BUYER@example.com ')).resolves.toEqual({
      contactId: 42,
      businessId: 'biz-1',
      email: 'buyer@example.com',
      name: 'Buyer',
      company: 'Example Co',
    });
    expect(runImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(imsQuery.mock.calls[1][1]).toEqual(['biz-1', 'buyer@example.com']);
  });

  it('does not query contacts when wholesale is disabled', async () => {
    imsQuery.mockResolvedValueOnce([{ value: 'no' }]);

    await expect(findWholesaleBuyerByEmail('biz-1', 'buyer@example.com')).resolves.toBeNull();
    expect(imsQuery).toHaveBeenCalledOnce();
  });

  it('rejects an ineligible contact during current-state revalidation', async () => {
    imsQuery
      .mockResolvedValueOnce([{ value: 'yes' }])
      .mockResolvedValueOnce([{
        id: 42,
        email: 'buyer@example.com',
        name: 'Buyer',
        company: 'Example Co',
        type: 'retail_customer',
        price_tier: 'retail',
        is_active: 1,
      }]);

    await expect(getActiveWholesaleBuyer('biz-1', 42)).resolves.toBeNull();
  });
});