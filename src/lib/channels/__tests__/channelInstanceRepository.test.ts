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

  it('rejects empty channel names', async () => {
    await expect(SalesChannelInstanceRepository.renameForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', displayName: ' ',
    })).rejects.toThrow('Channel display name is required.');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('records readiness without activating a disabled instance', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    mockQuery.mockResolvedValue([]);

    await SalesChannelInstanceRepository.setReadinessForBusiness({
      businessId: 'business-1', channelInstanceId: 'instance-1', ready: true,
    });

    expect(mockExecute.mock.calls[0][0]).toContain("WHEN is_enabled = 0 THEN 'paused'");
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
});