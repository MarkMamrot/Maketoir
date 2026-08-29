import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetImsSession, mockConnectionsGet, mockDecrypt, mockIssue, mockShopifyCtor,
  mockImsQuery, mockGetSettings, mockGetAccount, mockListRewards, mockReportRuntimeIssue,
} = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockConnectionsGet: vi.fn(),
  mockDecrypt: vi.fn(),
  mockIssue: vi.fn(),
  mockShopifyCtor: vi.fn(),
  mockImsQuery: vi.fn(),
  mockGetSettings: vi.fn(),
  mockGetAccount: vi.fn(),
  mockListRewards: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/ims/businessOperations', () => ({
  getOnlineChannelCapabilities: vi.fn().mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: false }),
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionsGet } }));
vi.mock('@/lib/encryption', () => ({ decrypt: mockDecrypt }));
vi.mock('@/lib/loyalty/ShopifyRewardIssuanceService', () => ({
  ShopifyRewardIssuanceService: { issue: mockIssue },
}));
vi.mock('@/lib/loyalty/LoyaltyService', () => ({ LoyaltyService: { getSettings: mockGetSettings } }));
vi.mock('@/lib/ims/LoyaltyRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/ims/LoyaltyRepository')>();
  return {
    ...original,
    LoyaltyRepository: { getAccount: mockGetAccount, listRewards: mockListRewards },
  };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/services/ShopifyService', async importOriginal => {
  const original = await importOriginal<typeof import('@/services/ShopifyService')>();
  return {
    ...original,
    ShopifyService: class {
      constructor(shop: string, token: string) { mockShopifyCtor(shop, token); }
    },
  };
});

import { ShopifyAdminUserError } from '@/services/ShopifyService';
import { GET, POST } from '../route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/ims/loyalty/shopify-rewards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ims/loyalty/shopify-rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', userId: 8 });
    mockConnectionsGet.mockResolvedValue({
      shopify_shop_id: 'example.myshopify.com',
      shopify_access_token: 'encrypted',
    });
    mockDecrypt.mockReturnValue('plain-token');
    mockIssue.mockResolvedValue({ redemptionId: 55, status: 'issued', voucherCode: 'SOLV-55-ABC' });
    mockImsQuery
      .mockResolvedValueOnce([{ loyalty_member: 1, shopify_customer_id: '12345' }])
      .mockResolvedValueOnce([{
        id: 55, display_name: '$10 off', value_aud: 10, status: 'issued',
        voucher_code: 'SOLV-55-ABC', created_at: '2026-08-05 09:00:00',
      }]);
    mockGetSettings.mockResolvedValue({
      enabled: true, earnRate: 1, programName: 'Rewards', pointsLabel: 'Points', startedAt: null,
    });
    mockGetAccount.mockResolvedValue({ balancePoints: 250 });
    mockListRewards.mockResolvedValue([{ id: 3, displayName: '$10 off', pointsCost: 100, valueAud: 10 }]);
    mockReportRuntimeIssue.mockResolvedValue(null);
  });

  it('returns the tenant customer balance, rewards, and exact Shopify-link status', async () => {
    const response = await GET(new Request('http://localhost/api/ims/loyalty/shopify-rewards?contactId=42'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockImsQuery).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), [42, 'business-1']);
    expect(body.loyalty).toMatchObject({
      active: true,
      member: true,
      shopifyLinked: true,
      balancePoints: 250,
      rewards: [{ id: 3, pointsCost: 100 }],
      issuedRedemptions: [{ id: 55, voucherCode: 'SOLV-55-ABC', status: 'issued' }],
    });
  });

  it('requires an authenticated IMS session', async () => {
    mockGetImsSession.mockResolvedValue(null);
    const response = await POST(request({ contactId: 42, rewardId: 3, idempotencyKey: 'claim-1' }));
    expect(response.status).toBe(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('validates the customer, reward, and idempotency key', async () => {
    const response = await POST(request({ contactId: 0, rewardId: 3 }));
    expect(response.status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('issues a reward with tenant credentials and the signed-in actor', async () => {
    const response = await POST(request({ contactId: 42, rewardId: 3, idempotencyKey: 'claim-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.redemption).toMatchObject({ redemptionId: 55, status: 'issued' });
    expect(mockShopifyCtor).toHaveBeenCalledWith('example.myshopify.com', 'plain-token');
    expect(mockIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', contactId: 42, rewardId: 3, idempotencyKey: 'claim-1', actorId: 8,
    }));
  });

  it('returns the write_discounts remediation when Shopify rejects the scope', async () => {
    mockIssue.mockRejectedValue(new ShopifyAdminUserError([{ message: 'Access denied for discountCodeBasicCreate' }]));
    const response = await POST(request({ contactId: 42, rewardId: 3, idempotencyKey: 'claim-1' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('write_discounts');
  });
});