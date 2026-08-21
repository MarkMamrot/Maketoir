import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mainConnection = {
    beginTransaction: vi.fn(), commit: vi.fn(), execute: vi.fn(), release: vi.fn(), rollback: vi.fn(),
  };
  return {
    mainConnection,
    mainPool: { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(mainConnection) },
    ensureApprovedWholesaleAccount: vi.fn(),
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: () => mocks.mainPool }));
vi.mock('../wholesaleCompanyAccount', () => ({
  ensureApprovedWholesaleAccount: mocks.ensureApprovedWholesaleAccount,
}));

import {
  approveWholesaleApplication,
  listWholesaleApplications,
  rejectWholesaleApplication,
} from '../wholesaleApplicationReview';

const application = {
  id: 17, business_id: 'biz-1', company_name: 'Example Co', contact_name: 'Alex Buyer',
  email: 'buyer@example.com', phone: '0400', abn: '51824753556', applicant_message: null,
  status: 'pending_review', email_verified_at: new Date(), linked_contact_id: null,
  linked_company_id: null, linked_location_id: null, linked_member_id: null,
  reviewed_by_name: null, reviewed_at: null, review_reason: null, created_at: new Date(),
};

describe('wholesale application review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mainConnection.execute.mockReset();
    mocks.mainPool.getConnection.mockResolvedValue(mocks.mainConnection);
    mocks.ensureApprovedWholesaleAccount.mockResolvedValue({
      contactId: 42, companyId: 50, locationId: 60, memberId: 70,
    });
  });

  it('lists applications within the authenticated business', async () => {
    mocks.mainPool.execute.mockResolvedValueOnce([[application]]);
    const rows = await listWholesaleApplications('biz-1', 'pending_review');
    expect(rows[0]).toMatchObject({ id: 17, companyName: 'Example Co', status: 'pending_review' });
    expect(mocks.mainPool.execute.mock.calls[0][1]).toEqual(['biz-1', 'pending_review']);
  });

  it('reuses an existing tenant contact and finalizes approval', async () => {
    mocks.mainConnection.execute
      .mockResolvedValueOnce([[application]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ status: 'approving', linked_contact_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(approveWholesaleApplication({
      businessId: 'biz-1', applicationId: 17, actorUserId: 7, actorName: 'Admin',
      allowedBrands: ['Brand A'], onAccountLimit: 5000,
    })).resolves.toEqual({ contactId: 42, companyId: 50, locationId: 60, memberId: 70, replayed: false });
    expect(mocks.ensureApprovedWholesaleAccount).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1', companyName: 'Example Co', allowedBrands: ['Brand A'], onAccountLimit: 5000,
    }));
    expect(mocks.mainConnection.execute.mock.calls[5][0]).toContain("'approved'");
  });

  it('rejects a verified pending application and records the reason atomically', async () => {
    mocks.mainConnection.execute
      .mockResolvedValueOnce([[application]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await rejectWholesaleApplication({
      businessId: 'biz-1', applicationId: 17, actorUserId: 7, actorName: 'Admin', reason: 'Outside our current range.',
    });
    expect(mocks.mainConnection.execute.mock.calls[1][1]).toContain('Outside our current range.');
    expect(mocks.mainConnection.execute.mock.calls[2][0]).toContain("'rejected'");
    expect(mocks.mainConnection.commit).toHaveBeenCalledOnce();
  });

  it('requires a rejection reason before opening a transaction', async () => {
    await expect(rejectWholesaleApplication({
      businessId: 'biz-1', applicationId: 17, actorUserId: 7, actorName: 'Admin', reason: ' ',
    })).rejects.toThrow('rejection reason');
    expect(mocks.mainPool.getConnection).not.toHaveBeenCalled();
  });
});