import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import { importAmazonRefundObservations } from '../amazonRefundImport';

const observation = {
  amazonOrderId: '111-2222222-3333333', amazonRefundId: 'refund-1', transactionId: 'transaction-1',
  postedAt: '2026-09-15T01:02:03.000Z', currencyCode: 'AUD', sellerNetAmount: -8.37, items: [],
};

describe('importAmazonRefundObservations', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ affectedRows: 1 }); });

  it('stores refund evidence only against an order from the exact channel instance', async () => {
    mocks.query.mockResolvedValue([{ id: 42 }]);
    await expect(importAmazonRefundObservations({
      businessId: 'business-1', channelInstanceId: 'instance-1', observations: [observation],
    })).resolves.toEqual({ observed: 1, ignored: 0 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("sales_channel = 'amazon'"), [
      'business-1', 'instance-1', '111-2222222-3333333',
    ]);
    expect(mocks.execute.mock.calls[0][1].slice(0, 2)).toEqual(['business-1', 'instance-1']);
    expect(mocks.execute.mock.calls[0][1][2]).toBe('refund:refund-1:transaction-1');
  });

  it('ignores refund evidence for an unknown or cross-instance order', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(importAmazonRefundObservations({
      businessId: 'business-1', channelInstanceId: 'instance-2', observations: [observation],
    })).resolves.toEqual({ observed: 0, ignored: 1 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});