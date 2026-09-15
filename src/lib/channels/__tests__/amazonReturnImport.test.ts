import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import { importAmazonReturnObservations } from '../amazonReturnImport';

const observation = {
  amazonOrderId: '111-2222222-3333333', amazonRmaId: 'RMA-1', merchantSku: 'SKU-1', asin: 'B001',
  itemName: 'Shirt', requestedAt: '2026-09-14T01:02:03Z', status: 'Completed', quantity: 1,
  reason: 'Too small', resolution: 'Refund', returnType: 'Customer return', deliveredAt: null,
  refundedAmount: 20, currencyCode: 'AUD',
};

describe('Amazon return observation import', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records an exact-instance return without changing stock or customer value', async () => {
    mocks.query.mockResolvedValue([{ id: 42 }]);
    await expect(importAmazonReturnObservations({
      businessId: 'business-1', channelInstanceId: 'instance-1', observations: [observation],
    })).resolves.toEqual({ observed: 1, ignored: 0 });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-1', observation.amazonOrderId]);
    expect(mocks.execute.mock.calls[0][0]).toContain("'return.observed'");
    expect(mocks.execute.mock.calls[0][1][2]).toBe('return:111-2222222-3333333:RMA-1:SKU-1');
  });

  it('retains a return for later linking when its order has not arrived in this instance', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(importAmazonReturnObservations({
      businessId: 'business-1', channelInstanceId: 'instance-2', observations: [observation],
    })).resolves.toEqual({ observed: 1, ignored: 1 });
    expect(mocks.execute.mock.calls[0][1][4]).toContain('"salesOrderId":null');
  });
});