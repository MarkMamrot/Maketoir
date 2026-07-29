import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockPoolQuery, mockQuery } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({
  execute: mockExecute,
  getPool: () => ({ query: mockPoolQuery }),
  query: mockQuery,
}));

import { ForesightIngestionRepository } from '../repositories/ForesightIngestionRepository';

describe('ForesightIngestionRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts a tenant-keyed sync run', async () => {
    mockExecute.mockResolvedValue({ insertId: 71 });

    await expect(ForesightIngestionRepository.startSyncRun(
      'business-1',
      ['google_ads', 'meta_ads'],
      '2026-05-01',
      '2026-07-29',
      12,
    )).resolves.toBe(71);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_sync_runs'),
      ['business-1', '["google_ads","meta_ads"]', '2026-05-01', '2026-07-29', 12],
    );
  });

  it('stores daily observations with business and run ownership', async () => {
    await ForesightIngestionRepository.appendPaidMediaObservations(71, 'business-1', [{
      metricDate: '2026-07-28',
      source: 'google_ads',
      accountId: 'account-1',
      spend: 25,
      impressions: 1000,
      clicks: 40,
      conversions: 2,
      attributedRevenue: 120,
      currencyCode: 'AUD',
    }]);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_marketing_observations'),
      [71, 'business-1', 'google_ads', 'account-1', '2026-07-28', 25, 1000, 40, 2, 120, 'AUD'],
    );
  });

  it('does not issue an insert for an empty observation set', async () => {
    await ForesightIngestionRepository.appendPaidMediaObservations(71, 'business-1', []);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('stores exact-tax commerce observations with cost coverage', async () => {
    await ForesightIngestionRepository.appendCommerceObservations(71, 'business-1', [{
      metricDate: '2026-07-28',
      channel: 'online',
      salesIncTax: 1100,
      salesTax: 100,
      returnsIncTax: 110,
      returnsTax: 10,
      salesCogs: 400,
      returnedCogs: 40,
      orderCount: 10,
      returnCount: 1,
      costLineCount: 21,
      missingCostLineCount: 0,
      costBasis: 'mixed',
    }]);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_commerce_observations'),
      [71, 'business-1', '2026-07-28', 'online', 1100, 100, 110, 10, 400, 40, 10, 1, 21, 0, 'mixed'],
    );
  });

  it('returns only the latest observation per source, account, and date with numeric values', async () => {
    mockQuery.mockResolvedValue([{
      metric_date: '2026-07-28T00:00:00.000Z',
      source: 'meta_ads',
      account_id: 'meta-1',
      spend: '12.5000',
      impressions: '1000',
      clicks: '20',
      conversions: '3.0000',
      attributed_revenue: '150.0000',
      currency_code: 'AUD',
    }]);

    await expect(ForesightIngestionRepository.getLatestPaidMediaTrend(
      'business-1',
      '2026-07-01',
      '2026-07-29',
    )).resolves.toEqual([{
      metricDate: '2026-07-28',
      source: 'meta_ads',
      accountId: 'meta-1',
      spend: 12.5,
      impressions: 1000,
      clicks: 20,
      conversions: 3,
      attributedRevenue: 150,
      currencyCode: 'AUD',
    }]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('MAX(run_id)'),
      ['business-1', '2026-07-01', '2026-07-29', 'business-1'],
    );
  });
});