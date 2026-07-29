import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRecommendation, mockGetConnection, mockDecrypt, mockRead, mockConstructor } = vi.hoisted(() => ({
  mockGetRecommendation: vi.fn(), mockGetConnection: vi.fn(), mockDecrypt: vi.fn(),
  mockRead: vi.fn(), mockConstructor: vi.fn(),
}));

vi.mock('../repositories/ForesightRepository', () => ({ ForesightRepository: { getRecommendation: mockGetRecommendation } }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockGetConnection } }));
vi.mock('@/lib/encryption', () => ({ decrypt: mockDecrypt }));
vi.mock('@/services/MetaAdsReadService', () => ({
  MetaAdsReadService: class {
    constructor(...args: unknown[]) { mockConstructor(...args); }
    getBudgetSettings = mockRead;
  },
}));

import { ForesightMetaExecutionPreflightService } from '../ForesightMetaExecutionPreflightService';

const contributor = {
  source: 'meta_ads', entityType: 'adset', entityId: 'adset-1', entityName: 'Broad',
  parentEntityId: 'campaign-1', parentEntityName: 'Prospecting', currentSpend: 500, previousSpend: 300,
  spendChange: 200, currentAttributedRevenue: 100, previousAttributedRevenue: 900,
  currentPlatformRoas: 0.2, previousPlatformRoas: 3, platformRoasChangePercent: -93,
  diagnosticScore: 10, signals: ['platform_roas_decline'],
};

describe('ForesightMetaExecutionPreflightService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecommendation.mockResolvedValue({
      state: 'approved', proposal_hash: 'proposal',
      proposed_action_json: { type: 'review_budget_reduction', maximumReductionPercent: 8 },
      evidence_json: { contributors: [contributor] },
    });
    mockGetConnection.mockResolvedValue({ meta_ad_account_id: '123', meta_access_token: 'encrypted' });
    mockDecrypt.mockReturnValue('decrypted-token');
    mockRead.mockResolvedValue({
      account: { accountId: '123', accountStatus: 1, currencyCode: 'AUD' },
      campaigns: [{ accountId: '123', campaignId: 'campaign-1', campaignName: 'Prospecting', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: null, lifetimeBudgetMinor: null }],
      adSets: [{ accountId: '123', adSetId: 'adset-1', adSetName: 'Broad', campaignId: 'campaign-1', configuredStatus: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetMinor: 5000, lifetimeBudgetMinor: null }],
    });
  });

  it('derives tenant credentials and entity IDs server-side', async () => {
    const result = await ForesightMetaExecutionPreflightService.preflight('business-1', 42, 'proposal');
    expect(result).toMatchObject({ executable: false, ready: true });
    expect(mockGetConnection).toHaveBeenCalledWith('business-1');
    expect(mockDecrypt).toHaveBeenCalledWith('encrypted');
    expect(mockConstructor).toHaveBeenCalledWith('decrypted-token', '123');
    expect(mockRead).toHaveBeenCalledWith({ campaignIds: [], adSetIds: ['adset-1'] });
  });

  it('does not load credentials for an unapproved recommendation', async () => {
    mockGetRecommendation.mockResolvedValue({ state: 'pending_approval', proposal_hash: 'proposal' });
    const result = await ForesightMetaExecutionPreflightService.preflight('business-1', 42, 'proposal');
    expect(result.blockers[0].code).toBe('recommendation_not_approved');
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('does not load credentials when the proposal hash is stale', async () => {
    const result = await ForesightMetaExecutionPreflightService.preflight('business-1', 42, 'stale');
    expect(result.blockers[0].code).toBe('proposal_hash_mismatch');
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('returns an explicit blocker for a malformed stored account ID', async () => {
    mockGetConnection.mockResolvedValue({ meta_ad_account_id: 'wrong-account', meta_access_token: 'encrypted' });
    const result = await ForesightMetaExecutionPreflightService.preflight('business-1', 42, 'proposal');
    expect(result.blockers[0].code).toBe('meta_account_id_invalid');
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });
});