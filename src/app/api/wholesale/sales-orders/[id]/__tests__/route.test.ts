import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/wholesale/wholesaleSession', () => ({
  requireActiveWholesaleSession: mocks.requireActiveWholesaleSession,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET } from '../route';

const session = {
  businessId: 'biz-1', contactId: 42, companyId: 50, locationId: 60, memberId: 70,
  memberRole: 'owner', imsDb: 'ims-1', email: 'buyer@example.com', name: 'Buyer', company: 'Example Co',
};

describe('wholesale sales order detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session, brandAccess: { mode: 'all', brands: null } });
  });

  it('requires the active contact, account, member, and a current location grant', async () => {
    mocks.imsQuery.mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost'), { params: { id: '81' } });

    expect(response.status).toBe(404);
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_company_id = ?');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('JOIN ims_wholesale_member_locations ml');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('ml.location_id = o.wholesale_location_id');
    expect(mocks.imsQuery.mock.calls[0][0]).toContain('o.wholesale_member_id = ?');
    expect(mocks.imsQuery.mock.calls[0][1]).toEqual([81, 'biz-1', 42, 50, 70]);
    expect(mocks.imsQuery).toHaveBeenCalledTimes(1);
  });

  it('returns safe order fields and product lines for an owned order', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 81, so_number: 'SO-0081', status: 'confirmed', total_amount: 120 }])
      .mockResolvedValueOnce([{ id: 9, product_name: 'Raincoat', qty_ordered: 2, qty_fulfilled: 1 }]);

    const response = await GET(new Request('http://localhost'), { params: { id: '81' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.order.so_number).toBe('SO-0081');
    expect(body.order.items).toHaveLength(1);
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['biz-1', 'biz-1', 81]);
  });
});