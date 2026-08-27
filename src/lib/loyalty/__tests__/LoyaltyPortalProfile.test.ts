import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPool, mockGetConnection, mockExecute, mockBegin, mockCommit, mockRollback, mockRelease } = vi.hoisted(() => ({
  mockGetPool: vi.fn(), mockGetConnection: vi.fn(), mockExecute: vi.fn(), mockBegin: vi.fn(),
  mockCommit: vi.fn(), mockRollback: vi.fn(), mockRelease: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ getPool: mockGetPool, query: vi.fn() }));

import { LoyaltyPortalProfileRepository } from '../LoyaltyPortalProfile';

const input = {
  businessId: 'business-1', slug: 'Example Rewards', displayName: 'Example Rewards', logoUrl: null,
  shopifyReturnUrl: 'https://example.myshopify.com', termsUrl: '', termsVersion: '2', privacyUrl: '',
  policyMode: 'hosted' as const, isActive: true, policyApproved: true,
  approvedBy: { userId: 9, name: 'Admin User' },
  merchant: {
    legalName: 'Example Retail Pty Ltd', tradingName: 'Example Retail', businessNumber: 'ABN 12 345 678 901',
    contactEmail: 'privacy@example.com', contactAddress: '1 Example Street, Sydney NSW 2000, Australia',
    jurisdiction: 'New South Wales, Australia',
  },
};

describe('LoyaltyPortalProfileRepository policy publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('APP_URL', 'https://solvantis.com.au');
    mockGetPool.mockReturnValue({ getConnection: mockGetConnection });
    mockGetConnection.mockResolvedValue({ execute: mockExecute, beginTransaction: mockBegin, commit: mockCommit, rollback: mockRollback, release: mockRelease });
  });

  it('publishes a hosted immutable snapshot and version-specific policy URLs in one transaction', async () => {
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await LoyaltyPortalProfileRepository.upsert(input);

    expect(mockBegin).toHaveBeenCalledOnce();
    expect(mockCommit).toHaveBeenCalledOnce();
    expect(mockRollback).not.toHaveBeenCalled();
    const versionParams = mockExecute.mock.calls[2][1];
    expect(versionParams).toEqual(expect.arrayContaining([
      'business-1', '2', 'hosted',
      'https://solvantis.com.au/rewards/example-rewards/terms?version=2',
      'https://solvantis.com.au/rewards/example-rewards/privacy?version=2',
      9, 'Admin User',
    ]));
    expect(mockExecute.mock.calls[3][1]).toContain(42);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('requires explicit business approval before an active publication', async () => {
    await expect(LoyaltyPortalProfileRepository.upsert({ ...input, policyApproved: false }))
      .rejects.toThrow('reviewed and approved');
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('rolls back when an existing version label has different content', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ business_id: 'business-1' }]])
      .mockResolvedValueOnce([[{ id: 7, content_hash: 'different' }]]);

    await expect(LoyaltyPortalProfileRepository.upsert(input)).rejects.toThrow('already published with different content');
    expect(mockRollback).toHaveBeenCalledOnce();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});