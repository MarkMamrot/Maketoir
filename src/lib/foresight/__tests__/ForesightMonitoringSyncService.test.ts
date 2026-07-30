import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasActive: vi.fn(),
  getConnection: vi.fn(),
  getDailyPerformance: vi.fn(),
  startRun: vi.fn(),
  recordTab: vi.fn(),
  appendDaily: vi.fn(),
  appendEntities: vi.fn(),
  appendCommerce: vi.fn(),
  completeRun: vi.fn(),
  getCommerce: vi.fn(),
}));

vi.mock('../repositories/ForesightRepository', () => ({
  ForesightRepository: { hasActiveOutcomeMonitoring: mocks.hasActive },
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: mocks.getConnection },
}));
vi.mock('@/lib/encryption', () => ({ decrypt: (value: string) => value }));
vi.mock('@/services/GoogleAdsService', () => ({
  GoogleAdsService: class {
    getDailyPerformance = mocks.getDailyPerformance;
  },
}));
vi.mock('../repositories/ForesightIngestionRepository', () => ({
  ForesightIngestionRepository: {
    startSyncRun: mocks.startRun,
    recordSyncTab: mocks.recordTab,
    appendPaidMediaObservations: mocks.appendDaily,
    appendPaidMediaEntityObservations: mocks.appendEntities,
    appendCommerceObservations: mocks.appendCommerce,
    completeSyncRun: mocks.completeRun,
  },
}));
vi.mock('../repositories/ImsCommerceRepository', () => ({
  ImsCommerceRepository: { getDailyCommerce: mocks.getCommerce },
}));

import { ForesightMonitoringSyncService } from '../ForesightMonitoringSyncService';

const googleRow = {
  segments: { date: '2026-07-31' },
  customer: { currency_code: 'AUD' },
  campaign: { id: '123', name: 'PMax' },
  metrics: { cost_micros: 88_000_000, impressions: 1000, clicks: 30, conversions: 4, conversions_value: 500 },
};

describe('ForesightMonitoringSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue(91);
    mocks.recordTab.mockResolvedValue(undefined);
    mocks.appendDaily.mockResolvedValue(undefined);
    mocks.appendEntities.mockResolvedValue(undefined);
    mocks.appendCommerce.mockResolvedValue(undefined);
    mocks.completeRun.mockResolvedValue(undefined);
    mocks.getCommerce.mockResolvedValue([]);
  });

  it('does no credential or platform work without an active monitoring window', async () => {
    mocks.hasActive.mockResolvedValue(false);

    const result = await ForesightMonitoringSyncService.syncActiveWindow('business-1', '2026-08-01');

    expect(result).toMatchObject({ skipped: true, reason: 'no_active_monitoring', runId: null });
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('records Google and authoritative commerce observations for active monitoring', async () => {
    mocks.hasActive.mockResolvedValue(true);
    mocks.getConnection.mockResolvedValue({
      google_ads_customer_id: '111-222-3333',
      google_ads_refresh_token: 'encrypted-token',
      meta_ad_account_id: null,
      meta_access_token: null,
    });
    mocks.getDailyPerformance.mockResolvedValue([googleRow]);

    const result = await ForesightMonitoringSyncService.syncActiveWindow('business-1', '2026-08-01');

    expect(mocks.startRun).toHaveBeenCalledWith(
      'business-1', ['google_ads', 'commerce'], '2026-07-19', '2026-08-01', null,
    );
    expect(mocks.appendDaily).toHaveBeenCalledWith(91, 'business-1', [expect.objectContaining({
      source: 'google_ads', metricDate: '2026-07-31', spend: 88,
    })]);
    expect(mocks.appendEntities).toHaveBeenCalledWith(91, 'business-1', [expect.objectContaining({
      entityId: '123', entityName: 'PMax', spend: 88,
    })]);
    expect(mocks.getCommerce).toHaveBeenCalledWith('business-1', '2026-07-19', '2026-08-01');
    expect(mocks.completeRun).toHaveBeenCalledWith(91, 'business-1', 'succeeded', 2, 0, null);
    expect(result).toMatchObject({ skipped: false, runId: 91, state: 'succeeded' });
  });
});
