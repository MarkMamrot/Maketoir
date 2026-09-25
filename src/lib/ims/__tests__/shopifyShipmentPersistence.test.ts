import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(), execute: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: mocks.getPool }));

import { persistShopifyShipment } from '@/lib/ims/shopifyShipmentPersistence';

const shipment = {
  shopifyFulfilmentId: '7001',
  status: 'success',
  createdAt: '2026-09-25T01:00:00Z',
  updatedAt: '2026-09-25T01:01:00Z',
  items: [{ shopifyLineItemId: '9001', quantity: 2 }],
  tracking: [],
};

describe('persistShopifyShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPool.mockReturnValue({ getConnection: async () => ({
      execute: mocks.execute,
      beginTransaction: mocks.begin,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }) });
  });

  it('persists and reloads a shipment through its exact channel instance identity', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: 'instance-2' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 81 }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    await persistShopifyShipment({
      businessId: 'business-1', channelInstanceId: 'instance-2', soId: 44, shipment,
    });

    expect(mocks.execute.mock.calls[1][0]).toContain('channel_instance_id');
    expect(mocks.execute.mock.calls[1][1].slice(0, 4)).toEqual(['business-1', 'instance-2', 44, '7001']);
    expect(mocks.execute.mock.calls[2][1]).toEqual(['business-1', 'instance-2', '7001']);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rejects a supplied instance that does not own the sales order', async () => {
    mocks.execute.mockResolvedValueOnce([[{ channel_instance_id: 'instance-1' }]]);

    await expect(persistShopifyShipment({
      businessId: 'business-1', channelInstanceId: 'instance-2', soId: 44, shipment,
    })).rejects.toThrow('does not own this sales order');
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('uses a stable legacy namespace for an unowned legacy order', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ channel_instance_id: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 81 }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    await persistShopifyShipment({ businessId: 'business-1', soId: 44, shipment });

    expect(mocks.execute.mock.calls[1][1].slice(0, 4)).toEqual(['business-1', 'legacy', 44, '7001']);
  });
});