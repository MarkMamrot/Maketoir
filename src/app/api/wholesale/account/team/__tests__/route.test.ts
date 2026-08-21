import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const mocks = vi.hoisted(() => ({
  requireActiveWholesaleSession: vi.fn(),
  runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  imsQuery: vi.fn(), getConnection: vi.fn(), sendEmail: vi.fn(), reportRuntimeIssue: vi.fn(),
}));
vi.mock('@/lib/wholesale/wholesaleSession', () => ({ requireActiveWholesaleSession: mocks.requireActiveWholesaleSession }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, getIMSPool: () => ({ getConnection: mocks.getConnection }) }));
vi.mock('@/lib/wholesale/wholesaleTeamNotifications', () => ({ sendWholesaleTeamAccessEmail: mocks.sendEmail }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { POST } from '../route';

const session = {
  businessId: 'biz-1', companyId: 50, locationId: 60, memberId: 70, memberRole: 'owner',
  contactId: 42, name: 'Owner', email: 'owner@example.com', company: 'Example Co', supplierSlug: 'supplier', imsDb: 'ims-1',
};

describe('wholesale account team access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveWholesaleSession.mockResolvedValue({ session });
    mocks.getConnection.mockResolvedValue(connection);
    mocks.sendEmail.mockResolvedValue({ sent: true });
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
  });

  it('atomically grants an existing approved contact access and appends audit history', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 90, name: 'Buyer', email: 'buyer@example.com' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 91 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 92 }]);
    const request = new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'buyer@example.com', role: 'admin' }) });

    expect((await POST(request)).status).toBe(200);
    expect(connection.execute.mock.calls[2][1]).toEqual(['biz-1', 50, 60, 90, 'admin']);
    expect(connection.execute.mock.calls[3][0]).toContain('INSERT IGNORE INTO ims_wholesale_member_locations');
    expect(connection.execute.mock.calls[3][1]).toEqual(['biz-1', 50, 91, 60]);
    expect(connection.execute.mock.calls[4][0]).toContain("'access_granted'");
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ eventId: 92, email: 'buyer@example.com', role: 'admin' }));
  });

  it('rolls back when the contact already has an active account membership', async () => {
    connection.execute
      .mockResolvedValueOnce([[{ id: 90, name: 'Buyer', email: 'buyer@example.com' }]])
      .mockResolvedValueOnce([[{ id: 91, company_id: 80, is_active: 1 }]]);
    const request = new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'buyer@example.com', role: 'buyer' }) });

    expect((await POST(request)).status).toBe(409);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});