import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), getConnection: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: mocks.getConnection, query: mocks.query }) }));

import { ForesightCreativeRepository } from '../repositories/ForesightCreativeRepository';

const observation = {
  source: 'google_ads' as const, accountId: '123', externalId: 'creative-1', creativeKind: 'ad' as const,
  name: 'Search ad', format: 'RESPONSIVE_SEARCH_AD', status: 'ENABLED', copy: { headlines: ['Fresh'] }, media: null,
  firstSeenOn: '2026-08-01', lastSeenOn: '2026-08-02',
  links: [{ entityType: 'campaign' as const, entityId: 'campaign-1', entityName: 'Search' }],
  metrics: [{ metricDate: '2026-08-02', impressions: 100, spend: 5, clicks: 3, conversions: 1,
    attributedRevenue: 20, reach: null, frequency: null, videoViews: null, currencyCode: 'AUD' }],
};

describe('ForesightCreativeRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({
      query: mocks.query, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release,
    });
    mocks.query.mockResolvedValue([{ insertId: 77 }]);
  });

  it('writes tenant-scoped identity, links and run metrics in one transaction', async () => {
    await expect(ForesightCreativeRepository.ingest(91, 'business-1', [observation])).resolves.toBe(1);

    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('LAST_INSERT_ID(id)'), expect.arrayContaining(['business-1', 'google_ads', '123', 'creative-1']));
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('foresight_creative_entity_links'), expect.arrayContaining(['business-1', 77, 'google_ads', '123', 'campaign']));
    expect(mocks.query).toHaveBeenNthCalledWith(3, expect.stringContaining('foresight_creative_daily_metrics'), expect.arrayContaining([91, 'business-1', 77, 'google_ads', '123']));
    expect(mocks.query).toHaveBeenNthCalledWith(4, expect.stringContaining('INTERVAL 24 MONTH'), ['business-1']);
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back the complete creative batch on any write failure', async () => {
    mocks.query.mockRejectedValueOnce(new Error('write failed'));

    await expect(ForesightCreativeRepository.ingest(91, 'business-1', [observation])).rejects.toThrow('write failed');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('loads latest-run diagnostic metrics and latest governed assessment by tenant', async () => {
    mocks.query
      .mockResolvedValueOnce([[{
        creative_id: 77, source: 'google_ads', name: 'Search ad', format: 'RESPONSIVE_SEARCH_AD',
        metric_date: '2026-08-01', impressions: '1000', clicks: '40', spend: '50',
        conversions: '3', attributed_revenue: '120', frequency: null,
      }]])
      .mockResolvedValueOnce([[{
        creative_id: 77, assessment_json: JSON.stringify({
          schemaVersion: 1, factualDescription: 'Ad', structuredTags: ['product-led'],
          brandFitObservations: ['Direct tone'], accessibilityIssues: [], compositionTraits: [],
          formatTraits: [], uncertainties: ['Image unavailable'], confidence: 0.7,
        }),
      }]]);

    const result = await ForesightCreativeRepository.listDiagnosticInputs(
      'business-1', '2026-07-19', '2026-08-01', 100,
    );

    expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('MAX(run_id)'), [
      'business-1', '2026-07-19', '2026-08-01', 'business-1',
      'business-1', '2026-07-19', '2026-08-01',
    ]);
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringContaining('MAX(id)'), ['business-1', 'business-1']);
    expect(result).toEqual([expect.objectContaining({
      creativeId: 77, tags: ['product-led'], brandFitObservations: ['Direct tone'],
      assessmentUncertainties: ['Image unavailable'], metrics: [expect.objectContaining({ impressions: 1000, clicks: 40 })],
    })]);
  });
});
