import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), processRefund: vi.fn(), reverseRefund: vi.fn(), xero: vi.fn(),
  recoverXero: vi.fn(), projectLoyalty: vi.fn(), processRefundTx: vi.fn(), lockCost: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSORepo: { processShopifyRefund: mocks.processRefund, processShopifyRefundInTransaction: mocks.processRefundTx },
}));
vi.mock('@/lib/ims/costing/fifoCostingService', () => ({ lockInventoryCostState: mocks.lockCost }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: { reverseRefund: mocks.reverseRefund },
}));
vi.mock('@/lib/ims/xeroHooks', () => ({
  triggerCNXeroSync: mocks.xero, syncCNXeroWithOutcome: mocks.recoverXero,
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mocks.projectLoyalty },
}));

import { applyShopifyOrderRefund, applyShopifyOrderRefundInTransaction, recoverShopifyOrderRefund } from '@/lib/channels/shopifyOrderRefund';

const refund = {
  id: 7001,
  order_id: 1001,
  transactions: [{ kind: 'refund', status: 'success', amount: '22.00', gateway: 'shopify_payments' }],
  refund_line_items: [{
    line_item_id: 9001,
    quantity: 2,
    subtotal: '20.00',
    total_tax: '2.00',
    restock_type: 'return',
    line_item: { id: 9001, variant_id: 8001, title: 'Blue Shirt', sku: 'BLUE' },
  }],
};

describe('transaction-owned Shopify refund', () => {
  const execute = vi.fn();
  const queryConnection: Pick<PoolConnection, 'execute'> = { execute };
  const connection = queryConnection as PoolConnection;
  const input = { businessId: 'business-1', channelInstanceId: 'instance-2', refund };
  let completed = false;
  let total = '22.00';

  beforeEach(() => {
    vi.resetAllMocks();
    completed = false;
    total = '22.00';
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM ims_sales_orders')) return [[{ id: 44, payment_gateway: 'shopify_payments' }]];
      if (sql.includes('FROM ims_credit_notes')) return [completed ? [{ id: 81, total_amount: total, tax_amount: '2.00' }] : []];
      return [{ affectedRows: 1 }];
    });
    mocks.processRefundTx.mockImplementation(async () => {
      completed = true;
      return { processed: true, restocked: 2, creditNoteId: 81 };
    });
  });

  it('writes and verifies the CN and derived financial status on the supplied connection only', async () => {
    await expect(applyShopifyOrderRefundInTransaction(connection, input)).resolves.toEqual({
      outcome: 'refunded', salesOrderId: 44, creditNoteId: 81,
    });
    expect(mocks.processRefundTx).toHaveBeenCalledWith(connection, 'business-1', expect.objectContaining({
      soId: 44, channelInstanceId: 'instance-2', shopifyRefundId: '7001', amount: 22, taxAmount: 2,
    }));
    expect(mocks.lockCost).toHaveBeenCalledWith(connection, 'business-1');
    expect(execute.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('refunded_amount >= total_amount'), [44, 'business-1', 'instance-2']);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.processRefund).not.toHaveBeenCalled();
    expect(mocks.reverseRefund).not.toHaveBeenCalled();
    expect(mocks.projectLoyalty).not.toHaveBeenCalled();
    expect(mocks.xero).not.toHaveBeenCalled();
    expect(mocks.recoverXero).not.toHaveBeenCalled();
  });

  it('verifies an existing completed note without restocking again', async () => {
    completed = true;
    await expect(applyShopifyOrderRefundInTransaction(connection, input))
      .resolves.toEqual({ outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81 });
    expect(mocks.processRefundTx).not.toHaveBeenCalled();
    expect(mocks.lockCost.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
  });

  it('rejects changed CN amounts before acknowledging or changing financial status', async () => {
    completed = true;
    total = '21.00';
    await expect(applyShopifyOrderRefundInTransaction(connection, input)).rejects.toThrow('changed credit note');
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE ims_sales_orders'), expect.anything());
  });

  it('rejects an unverifiable local result and propagates local write errors', async () => {
    mocks.processRefundTx.mockResolvedValueOnce({ processed: false, restocked: 0, creditNoteId: null });
    await expect(applyShopifyOrderRefundInTransaction(connection, input)).rejects.toThrow('could not verify');
    mocks.processRefundTx.mockRejectedValueOnce(new Error('Stock write failed'));
    await expect(applyShopifyOrderRefundInTransaction(connection, input)).rejects.toThrow('Stock write failed');
  });
});

describe('applyShopifyOrderRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processRefund.mockResolvedValue({ processed: true, restocked: 2, creditNoteId: 81 });
    mocks.reverseRefund.mockResolvedValue({ status: 'skipped', reason: 'original_award_not_found' });
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.xero.mockResolvedValue(undefined);
  });

  describe('recoverShopifyOrderRefund', () => {
    const input = { businessId: 'business-1', channelInstanceId: 'instance-2', refund };
    beforeEach(() => {
      vi.resetAllMocks();
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM ims_sales_orders')) return [{ id: 44, payment_gateway: 'shopify_payments' }];
        if (sql.includes('FROM ims_credit_notes')) return [{ id: 81, total_amount: '22.00', tax_amount: '2.00' }];
        if (sql.includes('FROM loyalty_accounts')) return [{ contact_id: 42 }];
        throw new Error(`Unexpected query: ${sql}`);
      });
      mocks.processRefund.mockResolvedValue({ processed: false, restocked: 0, creditNoteId: 81 });
      mocks.reverseRefund.mockResolvedValue({
        status: 'reversed', points: null,
        mutation: { transactionId: 9, accountId: 2, balanceAfter: 0, duplicate: true },
      });
      mocks.projectLoyalty.mockResolvedValue({ status: 'synced' });
      mocks.execute.mockResolvedValue({ affectedRows: 1 });
      mocks.recoverXero.mockResolvedValue({ status: 'linked', xeroId: 'xero-81' });
    });

    it('resumes downstream effects after the local refund already committed', async () => {
      await expect(recoverShopifyOrderRefund(input)).resolves.toEqual({
        outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81,
        accounting: { status: 'linked', xeroId: 'xero-81' },
      });
      expect(mocks.reverseRefund).toHaveBeenCalledWith(expect.objectContaining({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId,
        shopifyOrderId: '1001', shopifyRefundId: '7001', deferMetafieldSync: true,
      }));
      expect(mocks.query.mock.calls[1][1]).toEqual(['business-1', 44, 'instance-2', '7001', '7001']);
      expect(mocks.query.mock.calls[2][1]).toEqual(['business-1', 2]);
      expect(mocks.projectLoyalty).toHaveBeenCalledWith({
        businessId: 'business-1', channelInstanceId: 'instance-2', contactId: 42,
      });
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('refunded_amount >= total_amount'),
        [44, 'business-1', 'instance-2']);
      expect(mocks.recoverXero).toHaveBeenCalledWith('business-1', 81);
      expect(mocks.processRefund).not.toHaveBeenCalled();
      expect(mocks.xero).not.toHaveBeenCalled();
    });

    it('retries after loyalty failure without claiming another local refund was created', async () => {
      mocks.query.mockResolvedValueOnce([{ id: 44, payment_gateway: 'shopify_payments' }])
        .mockResolvedValueOnce([]);
      mocks.processRefund.mockResolvedValueOnce({ processed: true, restocked: 2, creditNoteId: 81 });
      mocks.reverseRefund.mockRejectedValueOnce(new Error('Loyalty unavailable'));

      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('Loyalty unavailable');
      expect(mocks.recoverXero).not.toHaveBeenCalled();
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({ outcome: 'duplicate', creditNoteId: 81 });
      expect(mocks.processRefund).toHaveBeenCalledTimes(1);
      expect(mocks.recoverXero).toHaveBeenCalledTimes(1);
    });

    it('applies a missing local refund once and verifies its committed note before downstream work', async () => {
      mocks.query.mockResolvedValueOnce([{ id: 44, payment_gateway: null }]).mockResolvedValueOnce([]);
      mocks.processRefund.mockResolvedValue({ processed: true, restocked: 2, creditNoteId: 81 });
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({
        outcome: 'refunded', creditNoteId: 81, accounting: { status: 'linked' },
      });
      expect(mocks.processRefund).toHaveBeenCalledTimes(1);
      expect(mocks.query.mock.calls[2][0]).toContain('FROM ims_credit_notes');
      expect(mocks.query.mock.invocationCallOrder[2]).toBeLessThan(mocks.reverseRefund.mock.invocationCallOrder[0]);
    });

    it('rejects a different credit-note identity after local processing', async () => {
      mocks.query.mockResolvedValueOnce([{ id: 44, payment_gateway: null }]).mockResolvedValueOnce([]);
      mocks.processRefund.mockResolvedValue({ processed: false, restocked: 0, creditNoteId: 82 });
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('incomplete, unowned or changed credit note');
      expect(mocks.reverseRefund).not.toHaveBeenCalled();
      expect(mocks.recoverXero).not.toHaveBeenCalled();
    });

    it('retries the Shopify projection even when the loyalty ledger mutation is already complete', async () => {
      mocks.projectLoyalty.mockResolvedValueOnce({ status: 'failed' });
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('loyalty projection is unfinished');
      expect(mocks.recoverXero).not.toHaveBeenCalled();
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({ outcome: 'duplicate' });
      expect(mocks.projectLoyalty).toHaveBeenCalledTimes(2);
    });

    it.each([
      { status: 'queued' },
      { status: 'blocked', reason: 'not_connected' },
      { status: 'not_required', reason: 'policy_disabled' },
    ])('preserves the accounting outcome instead of claiming posting succeeded: $status', async accounting => {
      mocks.recoverXero.mockResolvedValue(accounting);
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({ accounting });
    });

    it('can retry after an unknown Xero result with the same local credit note', async () => {
      mocks.recoverXero.mockRejectedValueOnce(new Error('Connection lost'));
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('Connection lost');
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({ creditNoteId: 81 });
      expect(mocks.recoverXero.mock.calls).toEqual([['business-1', 81], ['business-1', 81]]);
    });

    it('does not require a customer projection when no loyalty reversal applies', async () => {
      mocks.reverseRefund.mockResolvedValue({ status: 'skipped', reason: 'original_award_not_found' });
      await expect(recoverShopifyOrderRefund(input)).resolves.toMatchObject({ creditNoteId: 81 });
      expect(mocks.projectLoyalty).not.toHaveBeenCalled();
      expect(mocks.recoverXero).toHaveBeenCalled();
    });

    it.each([null, 0])('rejects ambiguous local completion with credit note %s', async creditNoteId => {
      mocks.query.mockResolvedValueOnce([{ id: 44, payment_gateway: null }]).mockResolvedValueOnce([]);
      mocks.processRefund.mockResolvedValue({ processed: false, restocked: 0, creditNoteId });
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('could not verify a local credit note');
      expect(mocks.reverseRefund).not.toHaveBeenCalled();
      expect(mocks.recoverXero).not.toHaveBeenCalled();
    });

    it.each([
      { notes: [] },
      { notes: [{ id: 81, total_amount: '23.00', tax_amount: '2.00' }] },
      { notes: [{ id: 81, total_amount: '22.00', tax_amount: '1.00' }] },
    ])(
      'rejects missing ownership/completion or changed local refund amounts ($notes)', async ({ notes }) => {
        mocks.query.mockImplementation(async (sql: string) =>
          sql.includes('FROM ims_credit_notes') ? notes : [{ id: 44, payment_gateway: null }]);
        await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('incomplete, unowned or changed credit note');
        expect(mocks.reverseRefund).not.toHaveBeenCalled();
        expect(mocks.recoverXero).not.toHaveBeenCalled();
      },
    );

    it('rejects a missing exact-instance order before any local refund mutation', async () => {
      mocks.query.mockResolvedValue([]);
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('not available for exact-instance refund');
      expect(mocks.processRefund).not.toHaveBeenCalled();
    });

    it('does not project another business account or continue to accounting', async () => {
      mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM ims_sales_orders')) return [{ id: 44, payment_gateway: null }];
        if (sql.includes('FROM ims_credit_notes')) return [{ id: 81, total_amount: 22, tax_amount: 2 }];
        return [];
      });
      await expect(recoverShopifyOrderRefund(input)).rejects.toThrow('account is not available for this business');
      expect(mocks.projectLoyalty).not.toHaveBeenCalled();
      expect(mocks.recoverXero).not.toHaveBeenCalled();
    });
  });

  it('processes a refund through the exact owned order and downstream identities', async () => {
    mocks.query.mockResolvedValue([{ id: 44, payment_gateway: 'shopify_payments' }]);

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2', refund,
    })).resolves.toEqual({ outcome: 'refunded', salesOrderId: 44, creditNoteId: 81 });
    expect(mocks.query.mock.calls[0][0]).toContain("sales_channel = 'shopify'");
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', '1001']);
    expect(mocks.processRefund).toHaveBeenCalledWith('business-1', expect.objectContaining({
      soId: 44, channelInstanceId: 'instance-2', shopifyRefundId: '7001',
      restockLines: [expect.objectContaining({ externalOrderItemId: '9001' })],
    }));
    expect(mocks.reverseRefund).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', channelInstanceId: 'instance-2',
      shopifyOrderId: '1001', shopifyRefundId: '7001',
    }));
    expect(mocks.execute.mock.calls[0][1]).toEqual([44, 'business-1', 'instance-2']);
    expect(mocks.xero).toHaveBeenCalledWith('business-1', 81);
  });

  it('does not select an order with the same external ID in another instance', async () => {
    mocks.query.mockResolvedValue([]);

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-3', refund,
    })).rejects.toThrow('not available for exact-instance refund');
    expect(mocks.processRefund).not.toHaveBeenCalled();
  });

  it('does not repeat loyalty, status, or Xero effects for a duplicate refund', async () => {
    mocks.query.mockResolvedValue([{ id: 44, payment_gateway: null }]);
    mocks.processRefund.mockResolvedValue({ processed: false, restocked: 0, creditNoteId: 81 });

    await expect(applyShopifyOrderRefund({
      businessId: 'business-1', channelInstanceId: 'instance-2', refund,
    })).resolves.toEqual({ outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81 });
    expect(mocks.reverseRefund).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.xero).not.toHaveBeenCalled();
  });
});