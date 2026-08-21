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

import { DELETE } from '../route';

describe('wholesale location archive safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session: { businessId: 'biz-1', companyId: 50, locationId: 60, memberId: 70, memberRole: 'owner', name: 'Owner', email: 'owner@example.com' } });
    mocks.getConnection.mockResolvedValue(connection);
    connection.rollback.mockResolvedValue(undefined);
  });

  it('requires switching away before archiving the selected location', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 60, location_name: 'Sydney', is_primary: 0 }]]);
    const response = await DELETE(new Request('http://localhost'), { params: { locationId: '60' } });
    expect(response.status).toBe(409);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});