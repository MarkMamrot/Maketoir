import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(), commit: vi.fn(), execute: vi.fn(), release: vi.fn(), rollback: vi.fn(),
  };
  return {
    connection,
    pool: { getConnection: vi.fn().mockResolvedValue(connection) },
    runImsForBusiness: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
  };
});

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => mocks.pool }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runImsForBusiness }));

import { ensureApprovedWholesaleAccount } from '../wholesaleCompanyAccount';

const input = {
  businessId: 'biz-1', companyName: 'Example Co', contactName: 'Alex Buyer',
  email: 'buyer@example.com', phone: '0400', abn: '51824753556',
  allowedBrands: ['Brand A'], onAccountLimit: 5000,
};

describe('ensureApprovedWholesaleAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.getConnection.mockResolvedValue(mocks.connection);
  });

  it('creates a contact, company, primary location and owner member atomically', async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 50 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 60 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 70 }]);

    await expect(ensureApprovedWholesaleAccount(input)).resolves.toEqual({
      contactId: 42, companyId: 50, locationId: 60, memberId: 70,
    });
    expect(mocks.runImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mocks.connection.execute.mock.calls[4][0]).toContain('INSERT INTO ims_wholesale_companies');
    expect(mocks.connection.execute.mock.calls[6][0]).toContain('INSERT INTO ims_wholesale_company_locations');
    expect(mocks.connection.execute.mock.calls[8][0]).toContain('INSERT INTO ims_wholesale_company_members');
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).not.toHaveBeenCalled();
  });

  it('reactivates and reuses an existing account graph on replay', async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{
        id: 42, type: 'both', address: '1 Main St', address2: null, suburb: 'Richmond',
        city: 'Melbourne', state: 'VIC', postcode: '3121', country: 'Australia',
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 50 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 60 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 70 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(ensureApprovedWholesaleAccount(input)).resolves.toEqual({
      contactId: 42, companyId: 50, locationId: 60, memberId: 70,
    });
    expect(mocks.connection.execute.mock.calls[3][0]).toContain('UPDATE ims_wholesale_companies');
    expect(mocks.connection.execute.mock.calls[5][0]).toContain('UPDATE ims_wholesale_company_locations');
    expect(mocks.connection.execute.mock.calls[7][0]).toContain('UPDATE ims_wholesale_company_members');
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back the full account when company provisioning fails', async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error('company insert failed'));

    await expect(ensureApprovedWholesaleAccount(input)).rejects.toThrow('company insert failed');
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
  });
});