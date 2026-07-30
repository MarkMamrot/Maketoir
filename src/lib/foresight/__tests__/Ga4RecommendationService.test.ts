import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLatestTab, mockGetTab, mockCreate, mockExpire } = vi.hoisted(() => ({
  mockLatestTab: vi.fn(), mockGetTab: vi.fn(), mockCreate: vi.fn(), mockExpire: vi.fn(),
}));
vi.mock('../repositories/ForesightIngestionRepository', () => ({
  ForesightIngestionRepository: { getLatestSyncTabOutcome: mockLatestTab },
  mysqlDateOnly: (value: Date) => [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-'),
}));
vi.mock('@/lib/db/MarketingDataRepository', () => ({ MarketingDataRepository: { getTab: mockGetTab } }));
vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: { createRecommendation: mockCreate, expireSupersededShadowRecommendations: mockExpire },
}));

import { Ga4RecommendationService } from '../Ga4RecommendationService';

describe('Ga4RecommendationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLatestTab.mockResolvedValue({
      run_id: 3, state: 'succeeded', window_start: '2026-05-01', window_end: '2026-07-29', row_count: 14,
    });
    mockGetTab.mockResolvedValue(Array.from({ length: 14 }, (_, index) => ({
      record_date: `2026-07-${String(index + 16).padStart(2, '0')}`,
      entity_name: 'Organic Search',
      metrics: {
        date: `202607${String(index + 16).padStart(2, '0')}`,
        sessionDefaultChannelGroup: 'Organic Search', sessions: '20',
        conversions: index < 7 ? '2' : '1', totalRevenue: '100',
      },
    })));
    mockCreate.mockResolvedValue(44);
    mockExpire.mockResolvedValue(0);
  });

  it('persists tenant-scoped GA4 funnel findings from a covering snapshot', async () => {
    const result = await Ga4RecommendationService.evaluateChannels('business-1', '2026-07-29');
    expect(mockGetTab).toHaveBeenCalledWith('business-1', 'ga4', 'GA4_Channels');
    expect(mockCreate).toHaveBeenCalledWith('business-1', expect.objectContaining({
      channel: 'ga4', ruleId: 'ga4_channel_conversion_rate_decline', policyVersion: 1,
      formulaVersion: 'foresight-ga4-channel-v1',
    }));
    expect(result).toMatchObject({ skipped: false, recommendationCount: 1 });
  });

  it('accepts native MySQL dates in a covering snapshot', async () => {
    mockLatestTab.mockResolvedValue({
      run_id: 3,
      state: 'succeeded',
      window_start: new Date(2026, 4, 1),
      window_end: new Date(2026, 6, 30),
      row_count: 14,
    });

    const result = await Ga4RecommendationService.evaluateChannels('business-1', '2026-07-29');
    expect(result.skipped).toBe(false);
  });

  it('skips stale snapshots without expiring existing findings', async () => {
    mockLatestTab.mockResolvedValue({
      run_id: 2, state: 'succeeded', window_start: '2026-05-01', window_end: '2026-07-20', row_count: 10,
    });
    const result = await Ga4RecommendationService.evaluateChannels('business-1', '2026-07-29');
    expect(result).toMatchObject({ skipped: true, skipReason: 'ga4_channel_snapshot_does_not_cover_window' });
    expect(mockGetTab).not.toHaveBeenCalled();
    expect(mockExpire).not.toHaveBeenCalled();
  });
});