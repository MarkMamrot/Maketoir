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

import { ForesightIngestionRepository, mysqlDateOnly } from '../repositories/ForesightIngestionRepository';

describe('ForesightIngestionRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes MySQL DATE objects and strings without shifting the business date', () => {
    expect(mysqlDateOnly(new Date(2026, 6, 16))).toBe('2026-07-16');
    expect(mysqlDateOnly('2026-07-16T00:00:00.000Z')).toBe('2026-07-16');
  });

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

  it('loads the latest tenant-scoped tab outcome for snapshot quality gating', async () => {
    mockQuery.mockResolvedValue([{
      run_id: 72,
      state: 'succeeded',
      row_count: 8,
      error_text: null,
      completed_at: '2026-07-29 08:00:00',
    }]);

    await expect(ForesightIngestionRepository.getLatestSyncTabOutcome(
      'business-1', 'klaviyo', 'Klaviyo_Flows',
    )).resolves.toMatchObject({ run_id: 72, state: 'succeeded', row_count: 8 });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY run_id DESC'),
      ['business-1', 'klaviyo', 'Klaviyo_Flows'],
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

  it('stores entity observations at campaign-day grain with parent context', async () => {
    await ForesightIngestionRepository.appendPaidMediaEntityObservations(71, 'business-1', [{
      metricDate: '2026-07-28',
      source: 'meta_ads',
      accountId: 'meta-1',
      entityType: 'adset',
      entityId: 'adset-1',
      entityName: 'Broad',
      parentEntityId: 'campaign-1',
      parentEntityName: 'Prospecting',
      spend: 25,
      impressions: 1000,
      clicks: 40,
      conversions: 2,
      attributedRevenue: 120,
      currencyCode: 'AUD',
    }]);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO foresight_marketing_entity_observations'),
      [71, 'business-1', 'meta_ads', 'meta-1', '2026-07-28', 'adset', 'adset-1', 'Broad',
        'campaign-1', 'Prospecting', 25, 1000, 40, 2, 120, 'AUD'],
    );
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

  it('returns latest-run entity observations with numeric values and identity', async () => {
    mockQuery.mockResolvedValue([{
      metric_date: '2026-07-28T00:00:00.000Z',
      source: 'google_ads',
      account_id: 'google-1',
      entity_type: 'campaign',
      entity_id: '101',
      entity_name: 'Brand Search',
      parent_entity_id: null,
      parent_entity_name: null,
      spend: '25.0000',
      impressions: '1000',
      clicks: '40',
      conversions: '2.0000',
      attributed_revenue: '120.0000',
      currency_code: 'AUD',
    }]);

    await expect(ForesightIngestionRepository.getLatestPaidMediaEntityTrend(
      'business-1', '2026-07-01', '2026-07-29',
    )).resolves.toEqual([expect.objectContaining({
      source: 'google_ads', entityType: 'campaign', entityId: '101', spend: 25,
    })]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/GROUP BY source, account_id, entity_type, entity_id, metric_date/),
      ['business-1', '2026-07-01', '2026-07-29', 'business-1'],
    );
  });
});