import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), getConnection: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({ getPool: () => ({ getConnection: mocks.getConnection }) }));

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
});
