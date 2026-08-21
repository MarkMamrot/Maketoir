import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsExecute: vi.fn(), reportRuntimeIssue: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.imsExecute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { DELETE } from '../route';

const session = { businessId: 'biz-1', companyId: 50, memberId: 70, memberRole: 'buyer' };

describe('wholesale saved order deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('allows buyers to delete only lists they created in their active company', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });

    expect((await DELETE(new Request('http://localhost'), { params: { id: '12' } })).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('created_by_member_id = ?');
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual([12, 'biz-1', 50, 70]);
  });

  it('allows account admins to delete company lists without crossing company ownership', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session: { ...session, memberRole: 'admin' } });

    expect((await DELETE(new Request('http://localhost'), { params: { id: '12' } })).status).toBe(200);
    expect(mocks.imsExecute.mock.calls[0][0]).not.toContain('created_by_member_id = ?');
    expect(mocks.imsExecute.mock.calls[0][0]).toContain('company_id = ?');
    expect(mocks.imsExecute.mock.calls[0][1]).toEqual([12, 'biz-1', 50]);
  });

  it('returns not found when no owned list is deleted', async () => {
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
    mocks.imsExecute.mockResolvedValueOnce({ affectedRows: 0 });

    expect((await DELETE(new Request('http://localhost'), { params: { id: '12' } })).status).toBe(404);
  });
});