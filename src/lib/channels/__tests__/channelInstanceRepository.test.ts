import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockQuery } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ execute: mockExecute, query: mockQuery }));

import { SalesChannelInstanceRepository } from '../channelInstanceRepository';

describe('SalesChannelInstanceRepository', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockQuery.mockReset();
  });

  it('lists only instances owned by the requested business', async () => {
    mockQuery.mockResolvedValue([{
      channel_instance_id: 'instance-1', business_id: 'business-1', provider: 'shopify',
      display_name: 'Australia Store', external_account_key: 'example.myshopify.com', is_enabled: 1,
      runtime_status: 'active', readiness_status: 'ready', settings_json: '{"buffer":2}',
      last_sync_at: null, safe_error: null,
    }]);

    await expect(SalesChannelInstanceRepository.listForBusiness(' business-1 ')).resolves.toEqual([{
      channelInstanceId: 'instance-1', businessId: 'business-1', provider: 'shopify',
      displayName: 'Australia Store', externalAccountKey: 'example.myshopify.com', enabled: true,
      runtimeStatus: 'active', readinessStatus: 'ready', settings: { buffer: 2 },
      lastSyncAt: null, safeError: null,
    }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ?'), ['business-1']);
  });

  it('creates the native store with a singleton key and no external identity', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await expect(SalesChannelInstanceRepository.create({
      businessId: 'business-1', provider: 'native_shop', displayName: 'Solvantis Online Store',
      channelInstanceId: 'native-instance',
    })).resolves.toBe('native-instance');

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sales_channel_instances'), [
      'native-instance', 'business-1', 'native_shop', 'Solvantis Online Store', null, 'native_shop', '{}',
    ]);
  });

  it('allows multiple Shopify stores by leaving the singleton key empty', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await SalesChannelInstanceRepository.create({
      businessId: 'business-1', provider: 'shopify', displayName: 'Australia Store',
      externalAccountKey: 'australia.myshopify.com', channelInstanceId: 'shopify-instance',
    });

    expect(mockExecute.mock.calls[0][1][5]).toBeNull();
  });

  it('requires an external account identity for connected providers', async () => {
    await expect(SalesChannelInstanceRepository.create({
      businessId: 'business-1', provider: 'amazon', displayName: 'Amazon AU',
    })).rejects.toThrow('External account identity is required for amazon.');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects unknown persisted statuses instead of silently enabling an instance', async () => {
    mockQuery.mockResolvedValue([{
      channel_instance_id: 'instance-1', business_id: 'business-1', provider: 'shopify',
      display_name: 'Store', external_account_key: 'store.myshopify.com', is_enabled: 1,
      runtime_status: 'unknown', readiness_status: 'ready', settings_json: null,
      last_sync_at: null, safe_error: null,
    }]);

    await expect(SalesChannelInstanceRepository.listForBusiness('business-1')).rejects.toThrow(
      'Unsupported sales channel runtime status: unknown.',
    );
  });

  it('renames only the business-owned instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([{
      channel_instance_id: 'instance-1', business_id: 'business-1', provider: 'shopify',
      display_name: 'Retail Store', external_account_key: 'store.myshopify.com', is_enabled: 0,
      runtime_status: 'paused', readiness_status: 'ready', settings_json: null,
      last_sync_at: null, safe_error: null,
    }]);

    const result = await SalesChannelInstanceRepository.renameForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', displayName: ' Retail Store ',
    });

    expect(result).toMatchObject({ displayName: 'Retail Store', enabled: false, runtimeStatus: 'paused' });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ? AND channel_instance_id = ?'), [
      'Retail Store', 'business-1', 'instance-1',
    ]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE business_id = ? AND channel_instance_id = ?'), [
      'business-1', 'instance-1',
    ]);
  });

  it('gates product publication on the exact business-owned instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
    await SalesChannelInstanceRepository.setProductPublicationEnabledForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', enabled: true,
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("'$.productPublicationEnabled'"), [
      1, 'business-1', 'instance-1',
    ]);
  });

  it('sets product assignment mode on the exact business-owned instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);
    await SalesChannelInstanceRepository.setProductAssignmentModeForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', mode: 'add_matches',
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("'$.productAssignmentMode'"), [
      'add_matches', 'business-1', 'instance-1',
    ]);
  });

  it('rejects an unsupported product assignment mode', async () => {
    await expect(SalesChannelInstanceRepository.setProductAssignmentModeForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', mode: 'sometimes' as never,
    })).rejects.toThrow('A valid product assignment mode is required.');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('sets Build Capacity policy on the exact business-owned instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setBuildCapacityPolicyForBusiness({
      businessId: ' business-1 ',
      channelInstanceId: ' instance-1 ',
      enabled: true,
      inventoryLocationIds: [7, 3, 7],
    });

    expect(mockExecute.mock.calls[0][0]).toContain("'$.buildCapacityEnabled'");
    expect(mockExecute.mock.calls[0][0]).toContain("'$.inventoryLocationIds'");
    expect(mockExecute.mock.calls[0][1]).toEqual([1, 7, 3, 'business-1', 'instance-1']);
  });

  it('rejects empty channel names', async () => {
    await expect(SalesChannelInstanceRepository.renameForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', displayName: ' ',
    })).rejects.toThrow('Channel display name is required.');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('sets an order location only on the exact business-owned Amazon instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setAmazonOrderLocationForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', locationId: 7.9,
    });

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("provider = 'amazon'"), [
      7, 'business-1', 'instance-1',
    ]);
  });

  it('advances the Amazon order cursor only on the exact instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await SalesChannelInstanceRepository.setAmazonOrderSyncCursorForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ',
      lastUpdatedAt: '2026-09-15T01:00:00.000Z',
    });
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("'$.ordersLastUpdatedAt'"), [
      '2026-09-15T01:00:00.000Z', 'business-1', 'instance-1',
    ]);
  });

  it('records dedicated Amazon setup evidence without marking the channel ready', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await SalesChannelInstanceRepository.markAmazonSetupOperationForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', operation: 'listings',
      completedAt: '2026-09-15T02:00:00.000Z',
    });

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("readiness_status = IF(is_enabled = 1"), [
      '$.listingsLastSyncedAt', '2026-09-15T02:00:00.000Z', 1, 1, 'business-1', 'instance-1',
    ]);
  });

  it('preserves active readiness after successful Amazon authorization or inventory verification', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await SalesChannelInstanceRepository.markAmazonSetupOperationForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', operation: 'inventory',
      completedAt: '2026-09-15T02:00:00.000Z',
    });

    expect(mockExecute.mock.calls[0][1]).toEqual([
      '$.inventoryLastSyncedAt', '2026-09-15T02:00:00.000Z', 0, 0, 'business-1', 'instance-1',
    ]);
  });

  it('persists the latest Amazon refund ambiguity count with its cursor', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await SalesChannelInstanceRepository.setAmazonRefundSyncCursorForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1',
      lastPostedAt: '2026-09-15T03:00:00.000Z', ambiguousCount: 2,
    });

    expect(mockExecute.mock.calls[0][0]).toContain("'$.refundsAmbiguousCount'");
    expect(mockExecute.mock.calls[0][1]).toEqual([
      '2026-09-15T03:00:00.000Z', 2, expect.any(String), 'business-1', 'instance-1',
    ]);
  });

  it('records readiness without activating a disabled instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setReadinessForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: true,
    });

    expect(mockExecute.mock.calls[0][0]).toContain("WHEN is_enabled = 0 AND runtime_status = 'draft' THEN 'draft'");
    expect(mockExecute.mock.calls[0][1]).toEqual(['ready', null, 1, 'business-1', 'instance-1']);
  });

  it('bounds the safe readiness error persisted for an instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setReadinessForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: false, safeError: 'x'.repeat(1200),
    });

    expect(mockExecute.mock.calls[0][1][0]).toBe('error');
    expect(mockExecute.mock.calls[0][1][1]).toHaveLength(1000);
    expect(mockExecute.mock.calls[0][1].slice(2)).toEqual([0, 'business-1', 'instance-1']);
  });

  it('activates Amazon only while the exact instance remains ready', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([{
      channel_instance_id: 'instance-1', business_id: 'business-1', provider: 'amazon',
      display_name: 'Amazon AU', external_account_key: 'seller-1', is_enabled: 1,
      runtime_status: 'active', readiness_status: 'ready', settings_json: '{}', last_sync_at: null, safe_error: null,
    }]);

    await expect(SalesChannelInstanceRepository.setAmazonActivationForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true, actorUserId: 7,
    })).resolves.toMatchObject({ enabled: true, runtimeStatus: 'active' });

    expect(mockExecute.mock.calls[0][0]).toContain("AND (? = 0 OR readiness_status = 'ready')");
    expect(mockExecute.mock.calls[0][1]).toEqual([
      1, 'active', '$.activatedAt', expect.any(String), '$.activatedByUserId', 7,
      'business-1', 'instance-1', 1,
    ]);
  });

  it('does not report an Amazon activation transition when the readiness guard changes', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 0 });

    await expect(SalesChannelInstanceRepository.setAmazonActivationForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', active: true,
    })).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('activates only a ready exact Shopify instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setShopifyActivationForBusiness({
      businessId: ' business-1 ', channelInstanceId: ' instance-1 ', active: true,
    });

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("provider = 'shopify'"), [
      1, 'active', 'business-1', 'instance-1', 1,
    ]);
    expect(mockExecute.mock.calls[0][0]).toContain("readiness_status = 'ready'");
  });
});