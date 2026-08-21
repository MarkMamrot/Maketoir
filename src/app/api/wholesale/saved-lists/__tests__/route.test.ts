import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = {
  beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
};
const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(),
  getConnection: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({
  imsQuery: mocks.imsQuery,
  getIMSPool: () => ({ getConnection: mocks.getConnection }),
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { GET, POST } from '../route';

const session = {
  businessId: 'biz-1', companyId: 50, memberId: 70, memberRole: 'buyer',
  contactId: 42, locationId: 60, email: 'buyer@example.com', name: 'Buyer', company: 'Example Co', imsDb: 'ims-1',
};

describe('wholesale saved orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
    mocks.getConnection.mockResolvedValue(connection);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
  });

  it('lists only company-owned templates and derives member management rights', async () => {
    mocks.imsQuery
      .mockResolvedValueOnce([{ id: 10, name: 'Core range', created_by_member_id: 70 }])
      .mockResolvedValueOnce([{ list_id: 10, variant_id: 'variant-1', quantity: 4 }]);

    const response = await GET();
    const body = await response.json();

    expect(mocks.imsQuery.mock.calls[0][1]).toEqual(['biz-1', 50]);
    expect(mocks.imsQuery.mock.calls[1][1]).toEqual(['biz-1', 'biz-1', 50]);
    expect(body.lists[0]).toEqual(expect.objectContaining({
      id: 10, createdByMe: true, canManage: true,
      items: [{ variantId: 'variant-1', quantity: 4 }],
    }));
  });

  it('commits header and variants in one tenant transaction', async () => {
    connection.execute
      .mockResolvedValueOnce([{ insertId: 12 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const request = new Request('http://localhost/api/wholesale/saved-lists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Winter range', items: [{ variantId: 'variant-1', quantity: 6 }] }),
    });

    expect((await POST(request)).status).toBe(200);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute.mock.calls[0][1]).toEqual(['biz-1', 50, 70, 'Winter range']);
    expect(connection.execute.mock.calls[1][1]).toEqual(['biz-1', 12, 'variant-1', 6]);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});