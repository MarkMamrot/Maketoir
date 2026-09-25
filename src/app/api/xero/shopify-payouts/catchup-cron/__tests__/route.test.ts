import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockRunImsForBusiness, mockGetCreds, mockFetchPayouts, mockIngest, mockAutoPost } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetCreds: vi.fn(),
  mockFetchPayouts: vi.fn(),
  mockIngest: vi.fn(),
  mockAutoPost: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/businessOperations', () => ({
  assertXeroAccountingEnabled: vi.fn().mockResolvedValue(undefined),
  isXeroAccountingDisabledError: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/ims/shopifyPayoutIngestion', () => ({
  getShopifyApiCreds: mockGetCreds,
  fetchPaidShopifyPayouts: mockFetchPayouts,
  ingestShopifyPayout: mockIngest,
}));
vi.mock('@/lib/ims/shopifyPayoutAutoPost', () => ({ autoPostShopifyPayout: mockAutoPost }));

import { POST } from '../route';

function request(secret?: string): Request {
  return new Request('http://localhost/api/xero/shopify-payouts/catchup-cron', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('POST /api/xero/shopify-payouts/catchup-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.SHOPIFY_PAYOUT_CATCHUP_DAYS;
    mockRunImsForBusiness.mockImplementation(async (_businessId, callback) => callback());
    mockGetCreds.mockResolvedValue({ shopName: 'test', token: 'token', base: 'https://test' });
    mockFetchPayouts.mockResolvedValue([]);
    mockIngest.mockResolvedValue({ status: 'planned' });
    mockAutoPost.mockResolvedValue({ status: 'skipped_disabled' });
  });

  it('rejects requests without the cron secret', async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('polls and ingests paid payouts inside each tenant context', async () => {
    mockQuery.mockResolvedValue([
      { business_id: 'biz-1', channel_instance_id: 'store-1' },
      { business_id: 'biz-1', channel_instance_id: 'store-2' },
    ]);
    mockFetchPayouts
      .mockResolvedValueOnce([{ id: 'payout-1', status: 'paid' }])
      .mockResolvedValueOnce([{ id: 'payout-2', status: 'paid' }]);

    const response = await POST(request('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockRunImsForBusiness.mock.calls.map(call => call[0])).toEqual(['biz-1', 'biz-1']);
    expect(mockIngest.mock.calls.map(call => [call[0], call[1], call[2].id])).toEqual([
      ['biz-1', 'store-1', 'payout-1'],
      ['biz-1', 'store-2', 'payout-2'],
    ]);
    expect(json).toMatchObject({ businesses: 1, instances: 2, discovered: 2, processed: 2, failed: 0 });
  });

  it('continues after one payout fails', async () => {
    mockQuery.mockResolvedValue([{ business_id: 'biz-1', channel_instance_id: 'store-1' }]);
    mockFetchPayouts.mockResolvedValue([{ id: 'payout-1' }, { id: 'payout-2' }]);
    mockIngest.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ status: 'planned' });

    const response = await POST(request('test-secret'));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(mockIngest).toHaveBeenCalledTimes(2);
    expect(json).toMatchObject({ discovered: 2, processed: 1, failed: 1 });
  });
});