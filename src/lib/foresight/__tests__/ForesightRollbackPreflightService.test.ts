import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetExecution,
  mockGetRecommendation,
  mockFindCompensation,
  mockGetConnection,
  mockGetCampaignSettings,
} = vi.hoisted(() => ({
  mockGetExecution: vi.fn(),
  mockGetRecommendation: vi.fn(),
  mockFindCompensation: vi.fn(),
  mockGetConnection: vi.fn(),
  mockGetCampaignSettings: vi.fn(),
}));

vi.mock('@/lib/foresight/repositories/ForesightExecutionRepository', () => ({
  ForesightExecutionRepository: {
    getExecution: mockGetExecution,
    findCompensation: mockFindCompensation,
  },
}));
vi.mock('@/lib/foresight/repositories/ForesightRepository', () => ({
  ForesightRepository: { getRecommendation: mockGetRecommendation },
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mockGetConnection },
}));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => value }));
vi.mock('@/services/GoogleAdsService', () => ({
  GoogleAdsService: class {
    getCampaignSettings = mockGetCampaignSettings;
  },
}));

import { ForesightRollbackPreflightService } from '../ForesightRollbackPreflightService';

const originalExecution = {
  id: 9, recommendation_id: 12, state: 'succeeded', compensates_execution_id: null,
  before_json: {
    account: { source: 'google_ads', customerId: '1112223333' },
    campaigns: [{ campaignId: '123', budgetId: '456', amountMicros: 100_000_000, currencyCode: 'AUD' }],
  },
  after_json: {
    matchesProposed: true,
    campaigns: [{
      customerId: '1112223333', currencyCode: 'AUD', campaignId: '123', campaignName: 'Search AU',
      status: 'ENABLED', budgetId: '456', budgetName: 'Search budget', amountMicros: 92_000_000,
      explicitlyShared: false, referenceCount: 1,
    }],
  },
};

describe('ForesightRollbackPreflightService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetExecution.mockResolvedValue(originalExecution);
    mockGetRecommendation.mockResolvedValue({ id: 12, state: 'succeeded', proposal_hash: 'proposal' });
    mockFindCompensation.mockResolvedValue(null);
    mockGetConnection.mockResolvedValue({
      google_ads_customer_id: '111-222-3333', google_ads_refresh_token: 'tenant-refresh-token',
    });
    mockGetCampaignSettings.mockResolvedValue([{
      customer: { id: '1112223333', currency_code: 'AUD' },
      campaign: { id: '123', name: 'Search AU', status: 'ENABLED' },
      campaign_budget: {
        id: '456', name: 'Search budget', amount_micros: 92_000_000,
        explicitly_shared: false, reference_count: 1,
      },
    }]);
  });

  it('builds restoration only from the tenant-bound verified receipt and live state', async () => {
    const result = await ForesightRollbackPreflightService.preflight('business-1', 12, 9, 'proposal');
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({
      budgetId: '456', currentAmountMicros: 92_000_000, proposedAmountMicros: 100_000_000,
    });
    expect(mockGetCampaignSettings).toHaveBeenCalledWith(['123']);
  });

  it('blocks a changed tenant account before constructing live rollback state', async () => {
    mockGetConnection.mockResolvedValue({
      google_ads_customer_id: '9999999999', google_ads_refresh_token: 'tenant-refresh-token',
    });
    const result = await ForesightRollbackPreflightService.preflight('business-1', 12, 9, 'proposal');
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe('account_changed');
    expect(mockGetCampaignSettings).not.toHaveBeenCalled();
  });

  it('blocks any prior compensation attempt before reading Google', async () => {
    mockFindCompensation.mockResolvedValue({ id: 10, state: 'failed', compensates_execution_id: 9 });
    const result = await ForesightRollbackPreflightService.preflight('business-1', 12, 9, 'proposal');
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe('rollback_already_attempted');
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockGetCampaignSettings).not.toHaveBeenCalled();
  });
});