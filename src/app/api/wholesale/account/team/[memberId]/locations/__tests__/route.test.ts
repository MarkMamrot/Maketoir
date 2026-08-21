import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_id: string, callback: () => Promise<unknown>) => callback()),
  getConnection: vi.fn(), reportRuntimeIssue: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection: mocks.getConnection }) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { PUT } from '../route';

const session = { businessId: 'biz-1', companyId: 50, locationId: 60, memberId: 70, memberRole: 'owner', name: 'Owner', email: 'owner@example.com' };

describe('wholesale member location assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
    mocks.getConnection.mockResolvedValue(connection);
    connection.rollback.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
  });

  it('replaces grants and default location in one audited transaction', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 71, contact_id: 43, role: 'buyer', name: 'Buyer', email: 'buyer@example.com' }]])
      .mockResolvedValueOnce([[{ id: 60 }, { id: 61 }]])
      .mockResolvedValueOnce([[{ location_id: 60 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 1 }]);
    const request = new Request('http://localhost', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationIds: [60, 61], defaultLocationId: 61 }) });

    expect((await PUT(request, { params: { memberId: '71' } })).status).toBe(200);
    expect(connection.execute.mock.calls[4][0]).toContain('INSERT INTO ims_wholesale_member_locations');
    expect(connection.execute.mock.calls[5][1]).toEqual([61, 71, 'biz-1', 50]);
    expect(connection.execute.mock.calls[6][0]).toContain("'locations_changed'");
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});