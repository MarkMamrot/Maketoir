import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockImsQuery, mockGetSettings, mockGetAccount, mockListRewards, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockImsQuery: vi.fn(),
  mockGetSettings: vi.fn(),
  mockGetAccount: vi.fn(),
  mockListRewards: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/loyalty/LoyaltyService', () => ({ LoyaltyService: { getSettings: mockGetSettings } }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({ LoyaltyRepository: { getAccount: mockGetAccount, listRewards: mockListRewards } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { GET } from '../route';

describe('GET /api/pos/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1' });
    mockImsQuery.mockResolvedValue([{ loyalty_member: 1 }]);
    mockGetSettings.mockResolvedValue({ enabled: true, startedAt: null, programName: 'Rewards', pointsLabel: 'Points' });
    mockGetAccount.mockResolvedValue({ balancePoints: 10 });
    mockListRewards.mockResolvedValue([{ id: 2, displayName: '$5 off', pointsCost: 500, valueAud: 5 }]);
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('loads an active tenant customer without assuming a soft-delete column', async () => {
    const response = await GET(new Request('http://localhost/api/pos/loyalty?contact_id=37086'));
    const [sql, params] = mockImsQuery.mock.calls[0];

    expect(response.status).toBe(200);
    expect(sql).toContain('business_id = ?');
    expect(sql).toContain('is_active = 1');
    expect(sql).not.toContain('deleted_at');
    expect(params).toEqual([37086, 'business-1']);
    expect(await response.json()).toMatchObject({ loyalty: { member: true, balancePoints: 10 } });
  });
});