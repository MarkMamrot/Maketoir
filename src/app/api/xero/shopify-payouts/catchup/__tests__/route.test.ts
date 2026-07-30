import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRequireAdminSession,
  mockAssertBusinessAccess,
  mockRunImsForBusiness,
  mockGetCreds,
  mockFetchPayouts,
  mockIngest,
} = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockAssertBusinessAccess: vi.fn(),
  mockRunImsForBusiness: vi.fn(),
  mockGetCreds: vi.fn(),
  mockFetchPayouts: vi.fn(),
  mockIngest: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
  assertBusinessAccess: mockAssertBusinessAccess,
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mockRunImsForBusiness }));
vi.mock('@/lib/ims/shopifyPayoutIngestion', () => ({
  getShopifyApiCreds: mockGetCreds,
  fetchPaidShopifyPayouts: mockFetchPayouts,
  ingestShopifyPayout: mockIngest,
}));

import { POST } from '../route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/xero/shopify-payouts/catchup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/xero/shopify-payouts/catchup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'biz-1' }, response: null });
    mockAssertBusinessAccess.mockReturnValue(null);
    mockRunImsForBusiness.mockImplementation((_businessId, callback) => callback());
    mockGetCreds.mockResolvedValue({ shopName: 'test', token: 'token', base: 'https://test' });
    mockFetchPayouts.mockResolvedValue([{ id: 'pay-1' }, { id: 'pay-2' }]);
    mockIngest.mockResolvedValue({ payoutId: 'pay-1', status: 'planned' });
  });

  it('polls and ingests the requested lookback inside tenant context', async () => {
    const response = await POST(request({ databaseId: 'biz-1', days: 30 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRunImsForBusiness).toHaveBeenCalledWith('biz-1', expect.any(Function));
    expect(mockFetchPayouts).toHaveBeenCalledWith(expect.objectContaining({ shopName: 'test' }), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mockIngest).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ days: 30, discovered: 2, processed: 2, failed: 0 });
  });

  it('rejects an invalid lookback before Shopify access', async () => {
    const response = await POST(request({ databaseId: 'biz-1', days: 91 }));

    expect(response.status).toBe(400);
    expect(mockRunImsForBusiness).not.toHaveBeenCalled();
  });

  it('continues after one payout fails and returns multi-status', async () => {
    mockIngest.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ status: 'planned' });

    const response = await POST(request({ databaseId: 'biz-1', days: 14 }));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({ discovered: 2, processed: 1, failed: 1 });
  });
});