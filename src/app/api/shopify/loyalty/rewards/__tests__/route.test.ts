import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  getByShop: vi.fn(),
  runIms: vi.fn(async (_businessId: string, work: () => Promise<unknown>) => work()),
  imsQuery: vi.fn(),
  issue: vi.fn(),
  report: vi.fn(),
  shopifyCtor: vi.fn(),
}));

vi.mock('@/lib/loyalty/ShopifyCustomerAccountAuth', () => ({
  ShopifyCustomerAccountAuthError: class extends Error {},
  verifyShopifyCustomerAccountToken: mocks.verify,
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { getByShopifyShopDomain: mocks.getByShop } }));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: mocks.runIms }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery }));
vi.mock('@/lib/loyalty/ShopifyRewardIssuanceService', () => ({ ShopifyRewardIssuanceService: { issue: mocks.issue } }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));
vi.mock('@/services/ShopifyService', () => ({
  ShopifyAdminUserError: class extends Error {},
  ShopifyService: class { constructor(shop: string, token: string) { mocks.shopifyCtor(shop, token); } },
}));

import { OPTIONS, POST } from '../route';

function request(body: unknown, token = 'signed-token'): Request {
  return new Request('https://solvantis.com.au/api/shopify/loyalty/rewards', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Shopify customer loyalty reward claim route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SHOPIFY_LOYALTY_APP_CLIENT_ID', 'client-id');
    vi.stubEnv('SHOPIFY_LOYALTY_APP_SECRET', 'app-secret');
    mocks.verify.mockReturnValue({ shopDomain: 'example.myshopify.com', shopifyCustomerId: '12345', tokenId: 'token-id' });
    mocks.getByShop.mockResolvedValue({
      business_id: 'business-1', shopify_shop_id: 'example.myshopify.com', shopify_access_token: 'admin-token',
    });
    mocks.imsQuery.mockResolvedValue([{ id: 42 }]);
    mocks.issue.mockResolvedValue({
      redemptionId: 55, status: 'issued', voucherCode: 'SOLV-55-ABC', rewardName: '$10 off',
      rewardValueAud: 10, balanceAfter: 175,
    });
    mocks.report.mockResolvedValue(null);
  });

  it('supports extension CORS preflight', async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('resolves the verified shop and exact customer inside tenant context before issuing', async () => {
    const response = await POST(request({ rewardId: 3, idempotencyKey: 'claim_12345678' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getByShop).toHaveBeenCalledWith('example.myshopify.com');
    expect(mocks.runIms).toHaveBeenCalledWith('business-1', expect.any(Function));
    expect(mocks.imsQuery).toHaveBeenCalledWith(expect.stringContaining('shopify_customer_id = ?'), ['business-1', '12345']);
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', contactId: 42, rewardId: 3,
      idempotencyKey: 'shopify-account:12345:claim_12345678', actorId: 'shopify-customer:12345',
    }));
    expect(body.redemption).toMatchObject({ voucherCode: 'SOLV-55-ABC', balanceAfter: 175 });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('does not enter a tenant context for an unknown shop', async () => {
    mocks.getByShop.mockResolvedValue(null);
    const response = await POST(request({ rewardId: 3, idempotencyKey: 'claim_12345678' }));
    expect(response.status).toBe(403);
    expect(mocks.runIms).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('rejects a valid JSON body that is not an object', async () => {
    const response = await POST(request(null));
    expect(response.status).toBe(400);
    expect(mocks.getByShop).not.toHaveBeenCalled();
    expect(mocks.runIms).not.toHaveBeenCalled();
  });

  it('rejects ambiguous or missing exact customer linkage', async () => {
    mocks.imsQuery.mockResolvedValue([{ id: 42 }, { id: 43 }]);
    const response = await POST(request({ rewardId: 3, idempotencyKey: 'claim_12345678' }));
    expect(response.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});