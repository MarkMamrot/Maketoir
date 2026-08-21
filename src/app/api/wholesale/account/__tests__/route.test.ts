import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET, PUT } from '../route';

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
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('JOIN ims_wholesale_member_locations wml');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('wm.company_id = ? AND wl.id = ?');
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([70, 'biz-1', 42, 50, 60]);
  });

  it('returns the selected location and granted locations without internal contact fields', async () => {
    mocks.imsQuery.mockResolvedValueOnce([{
      company_id: 50, company_name: 'Example Co', tax_id: '12345678901', payment_terms: '30 days', on_account_limit: '2500.00',
      location_id: 60, location_name: 'Sydney', is_primary: 1,
      billing_address: '1 Billing Rd', billing_country: 'Australia',
      shipping_address: '2 Shipping St', shipping_suburb: 'Newtown', shipping_state: 'NSW', shipping_postcode: '2042', shipping_country: 'Australia',
      member_id: 70, member_role: 'owner',
    }]).mockResolvedValueOnce([
      { id: 60, location_name: 'Sydney', is_primary: 1 },
      { id: 61, location_name: 'Melbourne', is_primary: 0 },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      company: { id: 50, name: 'Example Co', onAccountLimit: 2500 },
      location: { id: 60, name: 'Sydney', isPrimary: true, shippingAddress: { address: '2 Shipping St' } },
      member: { id: 70, role: 'owner' },
      locations: [{ id: 60, name: 'Sydney', isPrimary: true }, { id: 61, name: 'Melbourne', isPrimary: false }],
    });
    expect(JSON.stringify(body)).not.toContain('notes');
  });

  it('blocks buyers before attempting an address update', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({
      session: { ...session, memberRole: 'buyer' },
      brandAccess: { mode: 'all', brands: null },
    });
    const request = new Request('http://localhost/api/wholesale/account', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingAddress: {}, shippingAddress: {} }),
    });

    expect((await PUT(request)).status).toBe(403);
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('updates only the selected granted active location through the current member tuple', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 1 });
    const request = new Request('http://localhost/api/wholesale/account', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        billingAddress: { address: ' 1 Billing Rd ', city: 'Sydney', country: 'Australia' },
        shippingAddress: { address: '2 Shipping St', suburb: 'Newtown', state: 'NSW', postcode: '2042', country: 'Australia' },
      }),
    });

    expect((await PUT(request)).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('JOIN ims_wholesale_company_members wm');
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('JOIN ims_wholesale_member_locations wml');
    expect(mocks.imsExecute.mock.calls[0][0]).toContain("wl.status = 'active'");
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual([
      70, 42,
      '1 Billing Rd', null, null, 'Sydney', null, null, 'Australia',
      '2 Shipping St', null, 'Newtown', null, 'NSW', '2042', 'Australia',
      60, 'biz-1', 50,
    ]);
  });

  it('fails closed when the assigned location tuple no longer matches', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 0 });
    mocks.imsQuery.mockResolvedValueOnce([]);
    const request = new Request('http://localhost/api/wholesale/account', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingAddress: {}, shippingAddress: {} }),
    });

    expect((await PUT(request)).status).toBe(409);
  });

  it('accepts a no-op save when the assigned tuple still exists', async () => {
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 0 });
    mocks.imsQuery.mockResolvedValueOnce([{ id: 60 }]);
    const request = new Request('http://localhost/api/wholesale/account', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billingAddress: {}, shippingAddress: {} }),
    });

    expect((await PUT(request)).status).toBe(200);
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([70, 42, 60, 'biz-1', 50]);
  });
});