import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsCNRepo: { create: mocks.create } }));

import {
  listAmazonRefundResolutionGroups,
  reconcileAmazonRefunds,
  resolveAmazonRefundPair,
} from '../amazonRefundReconciliation';

const returnPayload = {
  amazonOrderId: '111-2222222-3333333', amazonRmaId: 'RMA-1', merchantSku: 'SKU-1', asin: 'B001',
  itemName: 'Returned item', requestedAt: '2026-09-14T00:00:00Z', status: 'Approved', quantity: 2,
  reason: 'Too small', resolution: 'Refund', returnType: 'Return', deliveredAt: '2026-09-15T00:00:00Z',
  refundedAmount: 55, currencyCode: 'AUD', salesOrderId: 42,
};
const refundPayload = {
  amazonOrderId: '111-2222222-3333333', amazonRefundId: 'refund-1', transactionId: 'transaction-1',
  postedAt: '2026-09-15T01:02:03.000Z', currencyCode: 'AUD', sellerNetAmount: -48.21, items: [], salesOrderId: 42,
};

describe('reconcileAmazonRefunds', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.create.mockReset();
    mocks.create.mockResolvedValue(7);
  });

  it('creates an externally settled draft with no automatic restock from one unambiguous evidence pair', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'refund.observed', payload_json: refundPayload },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        so_id: 42, so_number: 'AMZ-111', customer_id: 9, location_id: 3, source_so_item_id: 101,
        variant_id: 'variant-1', merchant_sku: 'SKU-1', local_sku: 'LOCAL-1', item_name: 'Returned item',
      }]);

    await expect(reconcileAmazonRefunds({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ created: 1, ambiguous: 0, ignored: 0 });
    const [creditNote, items, businessId, createdBy] = mocks.create.mock.calls[0];
    expect(creditNote).toMatchObject({
      source: 'amazon', settlement_method: 'external', settlement_status: 'complete',
      channel_instance_id: 'instance-1', external_return_id: 'RMA-1', external_refund_id: 'refund-1',
      tax_treatment: 'inc_tax',
    });
    expect(items).toEqual([expect.objectContaining({
      qty: 2, unit_price: 27.5, tax_rate: 0.1, restock: false, source_so_item_id: 101,
    })]);
    expect(businessId).toBe('business-1');
    expect(createdBy).toBe('Amazon reconciliation');
  });

  it('does not guess when an order has multiple unreconciled RMAs', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'return.observed', payload_json: { ...returnPayload, amazonRmaId: 'RMA-2' } },
        { event_type: 'refund.observed', payload_json: refundPayload },
      ])
      .mockResolvedValueOnce([]);
    await expect(reconcileAmazonRefunds({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ created: 0, ambiguous: 1, ignored: 0 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('ignores evidence already linked to an Amazon credit note', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'refund.observed', payload_json: refundPayload },
      ])
      .mockResolvedValueOnce([{ external_return_id: 'RMA-1', external_refund_id: 'refund-1' }]);
    await expect(reconcileAmazonRefunds({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual({ created: 0, ambiguous: 0, ignored: 1 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lists only unresolved orders with multiple RMA or refund choices', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'return.observed', payload_json: { ...returnPayload, amazonRmaId: 'RMA-2', refundedAmount: 20 } },
        { event_type: 'refund.observed', payload_json: refundPayload },
      ])
      .mockResolvedValueOnce([]);
    await expect(listAmazonRefundResolutionGroups({ businessId: 'business-1', channelInstanceId: 'instance-1' }))
      .resolves.toEqual([expect.objectContaining({
        amazonOrderId: returnPayload.amazonOrderId,
        returns: [expect.objectContaining({ amazonRmaId: 'RMA-1' }), expect.objectContaining({ amazonRmaId: 'RMA-2' })],
        refunds: [expect.objectContaining({ amazonRefundId: 'refund-1' })],
      })]);
  });

  it('creates the standard external draft for an explicitly selected same-order pair', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'refund.observed', payload_json: refundPayload },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        so_id: 42, so_number: 'AMZ-111', customer_id: 9, location_id: 3, source_so_item_id: 101,
        variant_id: 'variant-1', merchant_sku: 'SKU-1', local_sku: 'LOCAL-1', item_name: 'Returned item',
      }]);
    await expect(resolveAmazonRefundPair({
      businessId: 'business-1', channelInstanceId: 'instance-1', amazonOrderId: returnPayload.amazonOrderId,
      amazonRmaId: 'RMA-1', amazonRefundId: 'refund-1', createdBy: 'Admin user',
    })).resolves.toEqual({ creditNoteId: 7 });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      external_return_id: 'RMA-1', external_refund_id: 'refund-1', settlement_method: 'external',
    }), [expect.objectContaining({ restock: false })], 'business-1', 'Admin user');
  });

  it('rejects a selected return and refund from different Amazon orders', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { event_type: 'return.observed', payload_json: returnPayload },
        { event_type: 'refund.observed', payload_json: { ...refundPayload, amazonOrderId: 'different-order' } },
      ])
      .mockResolvedValueOnce([]);
    await expect(resolveAmazonRefundPair({
      businessId: 'business-1', channelInstanceId: 'instance-1', amazonOrderId: returnPayload.amazonOrderId,
      amazonRmaId: 'RMA-1', amazonRefundId: 'refund-1', createdBy: 'Admin user',
    })).rejects.toThrow('not a valid pair');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});