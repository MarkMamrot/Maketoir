import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  getConnection: vi.fn(), reportRuntimeIssue: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection: mocks.getConnection }) }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { DELETE } from '../route';

const session = { businessId: 'biz-1', companyId: 50, memberId: 70, memberRole: 'owner', name: 'Owner', email: 'owner@example.com' };

describe('wholesale account team owner safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
    mocks.getConnection.mockResolvedValue(connection);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
  });

  it('rejects removal of the last active owner inside the locked transaction', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 71, contact_id: 43, role: 'owner', name: 'Other Owner', email: 'other@example.com' }]])
      .mockResolvedValueOnce([[{ id: 71 }]]);

    const response = await DELETE(new Request('http://localhost'), { params: { memberId: '71' } });

    expect(response.status).toBe(409);
    expect(connection.execute.mock.calls[1][0]).toContain("role = 'owner'");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});