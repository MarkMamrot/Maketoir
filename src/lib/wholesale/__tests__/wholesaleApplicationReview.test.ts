import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mainConnection = {
    beginTransaction: vi.fn(), commit: vi.fn(), execute: vi.fn(), release: vi.fn(), rollback: vi.fn(),
  };
  const imsConnection = {
    beginTransaction: vi.fn(), commit: vi.fn(), execute: vi.fn(), release: vi.fn(), rollback: vi.fn(),
  };
  return {
    mainConnection,
    imsConnection,
    mainPool: { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(mainConnection) },
    imsPool: { getConnection: vi.fn().mockResolvedValue(imsConnection) },
    runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  };
});

vi.mock('@/services/MySQLService', () => ({ getPool: () => mocks.mainPool }));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => mocks.imsPool }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));

import {
  approveWholesaleApplication,
  listWholesaleApplications,
  rejectWholesaleApplication,
} from '../wholesaleApplicationReview';

const application = {
  id: 17, business_id: 'biz-1', company_name: 'Example Co', contact_name: 'Alex Buyer',
  email: 'buyer@example.com', phone: '0400', abn: '51824753556', applicant_message: null,
  status: 'pending_review', email_verified_at: new Date(), linked_contact_id: null,
  reviewed_by_name: null, reviewed_at: null, review_reason: null, created_at: new Date(),
};

describe('wholesale application review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mainPool.getConnection.mockResolvedValue(mocks.mainConnection);
    mocks.imsPool.getConnection.mockResolvedValue(mocks.imsConnection);
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
    mocks.imsConnection.execute
      .mockResolvedValueOnce([[{ id: 42, type: 'b2b_customer' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(approveWholesaleApplication({
      businessId: 'biz-1', applicationId: 17, actorUserId: 7, actorName: 'Admin',
      allowedBrands: ['Brand A'], onAccountLimit: 5000,
    })).resolves.toEqual({ contactId: 42, replayed: false });
    expect(mocks.runImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.imsConnection.execute.mock.calls[1][0]).toContain("price_tier = 'wholesale'");
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