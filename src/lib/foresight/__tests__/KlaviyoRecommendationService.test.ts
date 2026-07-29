import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLatestTab, mockGetTab, mockCreateRecommendation, mockExpire } = vi.hoisted(() => ({
  mockLatestTab: vi.fn(),
  mockGetTab: vi.fn(),
  mockCreateRecommendation: vi.fn(),
  mockExpire: vi.fn(),
}));

vi.mock('../repositories/ForesightIngestionRepository', () => ({
  ForesightIngestionRepository: { getLatestSyncTabOutcome: mockLatestTab },
}));
vi.mock('@/lib/db/MarketingDataRepository', () => ({
  MarketingDataRepository: { getTab: mockGetTab },
}));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: {
    createRecommendation: mockCreateRecommendation,
    expireSupersededShadowRecommendations: mockExpire,
  },
}));

import { KlaviyoRecommendationService } from '../KlaviyoRecommendationService';

describe('KlaviyoRecommendationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLatestTab.mockResolvedValue({ run_id: 72, state: 'succeeded', row_count: 1 });
    mockGetTab.mockResolvedValue([{
      entity_id: 'flow-1',
      entity_name: 'Welcome Series',
      metrics: JSON.stringify({ id: 'flow-1', name: 'Welcome Series', status: 'live', archived: 'false' }),
    }]);
    mockCreateRecommendation.mockResolvedValue(42);
    mockExpire.mockResolvedValue(1);
  });

  it('persists a consolidated lifecycle shadow finding from a successful snapshot', async () => {
    const result = await KlaviyoRecommendationService.evaluateLifecycle('business-1', '2026-07-29');

    expect(mockGetTab).toHaveBeenCalledWith('business-1', 'klaviyo', 'Klaviyo_Flows');
    expect(mockCreateRecommendation).toHaveBeenCalledWith('business-1', expect.objectContaining({
      channel: 'klaviyo',
      ruleId: 'klaviyo_lifecycle_coverage_gap',
      policyVersion: 1,
      formulaVersion: 'foresight-klaviyo-lifecycle-v1',
      expiresAt: '2026-08-12 23:59:59',
    }));
    expect(result).toMatchObject({ skipped: false, snapshotRunId: 72, recommendationCount: 1 });
  });

  it('does not evaluate or expire findings after a failed flow snapshot', async () => {
    mockLatestTab.mockResolvedValue({ run_id: 73, state: 'failed', row_count: 0 });

    const result = await KlaviyoRecommendationService.evaluateLifecycle('business-1', '2026-07-29');

    expect(result).toMatchObject({ skipped: true, skipReason: 'latest_flow_sync_failed' });
    expect(mockGetTab).not.toHaveBeenCalled();
    expect(mockCreateRecommendation).not.toHaveBeenCalled();
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it('expires stale shadows only after valid complete coverage', async () => {
    mockGetTab.mockResolvedValue([
      ['Welcome Series', 'welcome'],
      ['Abandoned Cart', 'cart'],
      ['Browse Abandonment', 'browse'],
      ['Post Purchase', 'post'],
      ['Win Back', 'win'],
      ['VIP Loyalty', 'vip'],
    ].map(([name, id]) => ({
      entity_id: id,
      entity_name: name,
      metrics: { id, name, status: 'live', archived: 'false' },
    })));

    const result = await KlaviyoRecommendationService.evaluateLifecycle('business-1', '2026-07-29');

    expect(result.recommendationCount).toBe(0);
    expect(mockExpire).toHaveBeenCalledWith(
      'business-1', ['klaviyo_lifecycle_coverage_gap'], [],
    );
  });
});