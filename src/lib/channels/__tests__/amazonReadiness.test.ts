import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstance: vi.fn(), setReadiness: vi.fn(), access: vi.fn(), participations: vi.fn(), requireAu: vi.fn(), query: vi.fn(),
  run: vi.fn(async (_businessId: string, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../channelInstanceRepository', () => ({ SalesChannelInstanceRepository: {
  getForBusiness: mocks.getInstance, setReadinessForBusiness: mocks.setReadiness,
} }));
vi.mock('../amazonCredentials', () => ({ getAmazonChannelAccess: mocks.access }));
vi.mock('../amazonSpApi', () => ({
  getAmazonMarketplaceParticipations: mocks.participations,
  requireActiveAmazonAustraliaParticipation: mocks.requireAu,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.run }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));

import { assessAmazonReadiness } from '../amazonReadiness';

describe('assessAmazonReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInstance.mockResolvedValue({
      provider: 'amazon',
      settings: {
        orderLocationId: 7,
        listingsLastSyncedAt: '2026-09-15T04:30:00Z',
        inventoryLastSyncedAt: '2026-09-15T04:45:00Z',
        ordersLastUpdatedAt: '2026-09-15T05:00:00Z',
        returnsLastRequestedAt: '2026-09-15T04:00:00Z',
        refundsLastPostedAt: '2026-09-15T05:00:00Z',
        refundsAmbiguousCount: 0,
      },
    });
    mocks.access.mockResolvedValue({ accessToken: 'token', sellerId: 'seller-1' });
    mocks.participations.mockResolvedValue([{ marketplace: { id: 'A39IBJ37TRP1C6' } }]);
    mocks.query.mockResolvedValue([{
      location_ready: 1, mapping_count: 3, unresolved_mapping_count: 0, inventory_mapping_count: 2,
      channel_job_issue_count: 0, shipping_job_issue_count: 0, open_amazon_credit_note_count: 0,
    }]);
  });

  it('marks readiness without activating when every operational check passes', async () => {
    const result = await assessAmazonReadiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', now: new Date('2026-09-15T05:10:00Z'),
    });

    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(mocks.setReadiness).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: true, safeError: null,
    });
  });

  it('fails closed with concrete blockers for unresolved work', async () => {
    mocks.query.mockResolvedValue([{
      location_ready: 1, mapping_count: 3, unresolved_mapping_count: 2, inventory_mapping_count: 2,
      channel_job_issue_count: 1, shipping_job_issue_count: 1, open_amazon_credit_note_count: 1,
    }]);
    mocks.getInstance.mockResolvedValue({
      provider: 'amazon', settings: { orderLocationId: 7, refundsAmbiguousCount: 2 },
    });

    const result = await assessAmazonReadiness({ businessId: 'business-1', channelInstanceId: 'instance-1' });

    expect(result.ready).toBe(false);
    expect(result.checks.find(check => check.key === 'mappings')?.detail).toContain('2 listing mappings');
    expect(result.checks.find(check => check.key === 'work_queue')?.detail).toContain('2 Amazon jobs');
    expect(result.checks.find(check => check.key === 'return_review')?.detail).toContain('2 Amazon refund matches');
    expect(mocks.setReadiness).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
  });

  it('rejects stale or out-of-order synchronization evidence and partial windows', async () => {
    mocks.getInstance.mockResolvedValue({ provider: 'amazon', settings: {
      orderLocationId: 7,
      listingsLastSyncedAt: '2026-09-15T03:00:00Z',
      inventoryLastSyncedAt: '2026-09-15T02:00:00Z',
      ordersLastUpdatedAt: '2026-09-15T04:55:00Z', ordersContinuationBefore: '2026-09-15T05:00:00Z',
      returnsLastRequestedAt: '2026-09-13T00:00:00Z',
      refundsLastPostedAt: '2026-09-15T04:00:00Z', refundsContinuationBefore: '2026-09-15T05:00:00Z',
      refundsAmbiguousCount: 0,
    } });
    const result = await assessAmazonReadiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', now: new Date('2026-09-15T05:10:00Z'),
    });
    expect(result.ready).toBe(false);
    expect(result.checks.find(check => check.key === 'inventory')?.passed).toBe(false);
    expect(result.checks.find(check => check.key === 'orders')?.passed).toBe(false);
    expect(result.checks.find(check => check.key === 'returns')?.passed).toBe(false);
    expect(result.checks.find(check => check.key === 'refunds')?.passed).toBe(false);
  });
});