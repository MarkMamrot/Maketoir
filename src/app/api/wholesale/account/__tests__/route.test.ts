import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};

describe('wholesale account profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session, brandAccess: { mode: 'all', brands: null } });
  });

  it('requires the current member and full account tuple', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]);

    expect((await GET()).status).toBe(404);
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('wm.company_id = ? AND wm.location_id = ?');
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([70, 'biz-1', 42, 50, 60]);
  });

  it('returns the assigned location without internal contact fields', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{
      company_id: 50, company_name: 'Example Co', tax_id: '12345678901', payment_terms: '30 days', on_account_limit: '2500.00',
      location_id: 60, location_name: 'Sydney', is_primary: 1,
      billing_address: '1 Billing Rd', billing_country: 'Australia',
      shipping_address: '2 Shipping St', shipping_suburb: 'Newtown', shipping_state: 'NSW', shipping_postcode: '2042', shipping_country: 'Australia',
      member_id: 70, member_role: 'owner',
    }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      company: { id: 50, name: 'Example Co', onAccountLimit: 2500 },
      location: { id: 60, name: 'Sydney', isPrimary: true, shippingAddress: { address: '2 Shipping St' } },
      member: { id: 70, role: 'owner' },
    });
    expect(JSON.stringify(body)).not.toContain('notes');
  });
});