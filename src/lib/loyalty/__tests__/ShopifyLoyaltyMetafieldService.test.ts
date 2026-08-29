import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery, mockGetSettings, mockGetAccount, mockListRewards, mockReportRuntimeIssue, mockConnectionsGet } = vi.hoisted(() => ({
  mockImsQuery: vi.fn(),
  mockGetSettings: vi.fn(),
  mockGetAccount: vi.fn(),
  mockListRewards: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
  mockConnectionsGet: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));
vi.mock('@/lib/loyalty/LoyaltyService', () => ({ LoyaltyService: { getSettings: mockGetSettings } }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyRepository: { getAccount: mockGetAccount, listRewards: mockListRewards },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));
vi.mock('@/lib/db/ConnectionsRepository', () => ({ ConnectionsRepository: { get: mockConnectionsGet } }));
vi.mock('@/lib/ims/businessOperations', () => ({
  getOnlineChannelCapabilities: vi.fn().mockResolvedValue({ shopifyEnabled: true, nativeShopEnabled: false }),
}));
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(value => value) }));

import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';

describe('ShopifyLoyaltyMetafieldService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsQuery.mockResolvedValue([{ id: 42, loyalty_member: 1, shopify_customer_id: '12345' }]);
    mockGetSettings.mockResolvedValue({
      enabled: true, earnRate: 1, programName: 'Club Rewards', pointsLabel: 'Stars', startedAt: null,
    });
    mockGetAccount.mockResolvedValue({ balancePoints: 275 });
    mockListRewards.mockResolvedValue([{
      id: 3, rewardCode: 'ten-off', displayName: '$10 off', pointsCost: 100, valueAud: 10,
    }]);
    mockReportRuntimeIssue.mockResolvedValue(null);
    mockConnectionsGet.mockResolvedValue(null);
  });

  it('skips configured sync cleanly when the tenant has no Shopify connection', async () => {
    await expect(ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
      businessId: 'business-1', contactId: 42,
    })).resolves.toEqual({ status: 'skipped', contactId: 42, reason: 'shopify_not_configured' });
    expect(mockImsQuery).not.toHaveBeenCalled();
    expect(mockReportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('publishes the current member balance, labels, and active rewards', async () => {
    const shopify = { setCustomerMetafields: vi.fn().mockResolvedValue(undefined) };

    await expect(ShopifyLoyaltyMetafieldService.syncCustomer({
      businessId: 'business-1', contactId: 42, shopify,
    })).resolves.toEqual({ status: 'synced', contactId: 42, shopifyCustomerId: '12345', balancePoints: 275 });

    const fields = shopify.setCustomerMetafields.mock.calls[0][1];
    expect(shopify.setCustomerMetafields).toHaveBeenCalledWith('12345', expect.any(Array));
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ namespace: 'solvantis_loyalty', key: 'member', value: 'true' }),
      expect.objectContaining({ key: 'balance_points', type: 'number_integer', value: '275' }),
      expect.objectContaining({ key: 'program_name', value: 'Club Rewards' }),
      expect.objectContaining({ key: 'rewards', value: JSON.stringify([{ rewardId: 3, code: 'ten-off', name: '$10 off', pointsCost: 100, valueAud: 10 }]) }),
    ]));
  });

  it('publishes an opted-out customer with zero balance and no rewards', async () => {
    mockImsQuery.mockResolvedValue([{ id: 42, loyalty_member: 0, shopify_customer_id: '12345' }]);
    const shopify = { setCustomerMetafields: vi.fn().mockResolvedValue(undefined) };

    await ShopifyLoyaltyMetafieldService.syncCustomer({ businessId: 'business-1', contactId: 42, shopify });

    const fields = shopify.setCustomerMetafields.mock.calls[0][1];
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'member', value: 'false' }),
      expect.objectContaining({ key: 'balance_points', value: '0' }),
      expect.objectContaining({ key: 'rewards', value: '[]' }),
    ]));
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it('reports Shopify failures without throwing into the completed loyalty operation', async () => {
    const shopify = { setCustomerMetafields: vi.fn().mockRejectedValue(new Error('Shopify unavailable')) };

    await expect(ShopifyLoyaltyMetafieldService.syncCustomer({
      businessId: 'business-1', contactId: 42, shopify,
    })).resolves.toMatchObject({ status: 'failed', contactId: 42, error: 'Shopify unavailable' });
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sync_customer_metafields' }));
  });
});