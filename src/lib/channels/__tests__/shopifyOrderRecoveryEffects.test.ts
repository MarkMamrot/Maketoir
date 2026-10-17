import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), award: vi.fn(), mark: vi.fn(), project: vi.fn(), recoverRefund: vi.fn(),
  mutation: vi.fn(), report: vi.fn(), main: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.main }));
vi.mock('@/lib/loyalty/ShopifyLoyaltyService', () => ({
  ShopifyLoyaltyService: { awardPaidOrder: mocks.award, markPaidOrderRedemptionsUsed: mocks.mark },
}));
vi.mock('@/lib/loyalty/ShopifyLoyaltyMetafieldService', () => ({
  ShopifyLoyaltyMetafieldService: { syncConfiguredCustomer: mocks.project },
}));
vi.mock('@/lib/channels/shopifyOrderRefund', () => ({ recoverShopifyOrderRefund: mocks.recoverRefund }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyRepository: { getMutationByIdempotencyKey: mocks.mutation },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));

import { recoverShopifyPaidOrderEffects, recoverShopifyRefundDownstreamEffects } from '../shopifyOrderRecoveryEffects';

const identity = { businessId: 'business-1', channelInstanceId: 'instance-2' };
const order = {
  id: 1001, customer: { id: 42 }, subtotal_price: '100.00',
  processed_at: '2026-08-01T18:00:00Z', updated_at: '2026-09-01T18:00:00Z',
  discount_codes: [{ code: 'REWARD' }],
  line_items: [
    { quantity: 1, price: '80', gift_card: false, discount_allocations: [{ amount: '10' }] },
    { quantity: 1, price: '30', gift_card: true },
  ],
};
const refund = {
  id: 7001, order_id: 1001,
  transactions: [{ kind: 'refund', status: 'success', amount: '22.00' }],
  refund_line_items: [{ subtotal: '20', total_tax: '2' }],
};
const refundInput = { ...identity, refund, creditNoteId: 81 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.award.mockResolvedValue({ status: 'awarded', points: null, mutation: { accountId: 2, duplicate: true } });
  mocks.project.mockResolvedValue({ status: 'synced' });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('xero_sync_log')) throw new Error('Accounting completion ledger is not in the tenant schema.');
    if (sql.includes('loyalty_accounts')) return [{ contact_id: 42 }];
    if (sql.includes('cn.total_amount')) return [{ id: 81, total_amount: '22.00', tax_amount: '2.00' }];
    return [{ id: 81 }];
  });
  mocks.mutation.mockResolvedValue(null);
  mocks.main.mockResolvedValue([{ id: 71 }]);
  mocks.recoverRefund.mockResolvedValue({
    outcome: 'duplicate', salesOrderId: 44, creditNoteId: 81,
    accounting: { status: 'linked', xeroId: 'xero-cn-81' },
  });
});

describe('paid order recovery effects', () => {
  it('preserves eligible spend, historical business paid date and exact identities', async () => {
    await expect(recoverShopifyPaidOrderEffects({ ...identity, order })).resolves.toEqual({ status: 'completed' });
    expect(mocks.mark).toHaveBeenCalledWith({
      ...identity, shopifyOrderId: '1001', shopifyCustomerId: '42', discountCodes: ['REWARD'],
    });
    expect(mocks.award).toHaveBeenCalledWith({
      ...identity, shopifyOrderId: '1001', paidDate: '2026-08-02',
      eligibleSpend: 70, deferMetafieldSync: true, allowRefundedOrder: false,
    });
    expect(mocks.project).toHaveBeenCalledWith({ ...identity, contactId: 42 });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('business_id = ?'), ['business-1', 2]);
    expect(mocks.recoverRefund).not.toHaveBeenCalled();
  });

  it('retries projection on an already committed duplicate award', async () => {
    mocks.project.mockResolvedValueOnce({ status: 'failed', error: 'secret payload' });
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order }))
      .toEqual({ status: 'retry', reason: 'loyalty_projection_failed' });
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order })).toEqual({ status: 'completed' });
    expect(mocks.award).toHaveBeenCalledTimes(2);
    expect(mocks.project).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('secret payload');
  });

  it.each(['partially_refunded', 'refunded'])('allows historical %s earning before reversal', async financial_status => {
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order: { ...order, financial_status } }))
      .toEqual({ status: 'completed' });
    expect(mocks.award).toHaveBeenCalledWith(expect.objectContaining({
      allowRefundedOrder: true, paidDate: '2026-08-02', eligibleSpend: 70,
    }));
  });

  it.each(['customer_not_found', 'shopify_not_linked', 'shopify_instance_ambiguous'])(
    'does not acknowledge skipped projection %s', async reason => {
      mocks.project.mockResolvedValueOnce({ status: 'skipped', reason });
      expect(await recoverShopifyPaidOrderEffects({ ...identity, order }))
        .toEqual({ status: 'blocked', reason: `loyalty_projection_${reason}` });
    },
  );

  it('blocks missing local order/account, but preserves legitimate loyalty skips', async () => {
    mocks.award.mockResolvedValueOnce({ status: 'skipped', reason: 'order_not_found' });
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order })).toMatchObject({ status: 'blocked' });
    mocks.award.mockResolvedValueOnce({ status: 'skipped', reason: 'not_paid' });
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order })).toEqual({ status: 'completed' });
    mocks.query.mockResolvedValueOnce([]);
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order }))
      .toEqual({ status: 'blocked', reason: 'loyalty_account_missing' });
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it('returns sanitized retry for failed ledger/redemption work', async () => {
    mocks.mark.mockRejectedValueOnce(new Error('token=secret; customer payload'));
    expect(await recoverShopifyPaidOrderEffects({ ...identity, order }))
      .toEqual({ status: 'retry', reason: 'paid_order_effects_failed' });
    expect(mocks.award).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('secret');
  });

  it('rejects absent exact identity before domain work', async () => {
    expect(await recoverShopifyPaidOrderEffects({ ...identity, channelInstanceId: '', order }))
      .toEqual({ status: 'blocked', reason: 'invalid_identity' });
    expect(mocks.award).not.toHaveBeenCalled();
  });
});

describe('refund downstream recovery effects', () => {
  it('reuses only verified completed CN and verifies accounting completion', async () => {
    expect(await recoverShopifyRefundDownstreamEffects(refundInput)).toEqual({ status: 'completed' });
    expect(mocks.recoverRefund).toHaveBeenCalledWith({ ...identity, refund });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 81, 'instance-2', '1001', 'instance-2', '7001', '7001']);
    expect(mocks.query.mock.calls[0][0]).toContain("cn.status = 'complete'");
    expect(mocks.query.mock.calls[1][1]).toEqual(['business-1', 81, 'xero-cn-81']);
    expect(mocks.query.mock.calls[1][0]).not.toContain('xero_sync_log');
    expect(mocks.main).toHaveBeenCalledWith(
      expect.stringContaining('BINARY business_id = BINARY ?'), ['business-1', 81, 'xero-cn-81'],
    );
    expect(mocks.main.mock.calls[0][0]).toContain("xero_state = 'AUTHORISED'");
    expect(mocks.main.mock.calls[0][0]).toContain("status = 'success'");
    expect(mocks.main.mock.calls[0][0]).toContain("sync_type = 'cn_credit_note'");
  });

  it.each([
    { notes: [] }, { notes: [{ id: 81, total_amount: '21', tax_amount: '2' }] },
    { notes: [{ id: 81, total_amount: '22', tax_amount: '1' }] },
  ])(
    'never enters local refund owner without matching completed CN evidence: %j', async ({ notes }) => {
      mocks.query.mockResolvedValueOnce(notes);
      expect(await recoverShopifyRefundDownstreamEffects(refundInput))
        .toEqual({ status: 'blocked', reason: 'completed_credit_note_unverified' });
      expect(mocks.recoverRefund).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ status: 'blocked', reason: 'not_connected' }, 'blocked', 'accounting_not_connected'],
    [{ status: 'queued' }, 'retry', 'accounting_queued'],
  ])('retains unfinished accounting %j', async (accounting, status, reason) => {
    mocks.recoverRefund.mockResolvedValueOnce({ outcome: 'duplicate', creditNoteId: 81, accounting });
    expect(await recoverShopifyRefundDownstreamEffects(refundInput)).toEqual({ status, reason });
  });

  it('does not mistake a linked Xero ID for completed accounting', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 81, total_amount: '22', tax_amount: '2' }]).mockResolvedValueOnce([]);
    expect(await recoverShopifyRefundDownstreamEffects(refundInput))
      .toEqual({ status: 'blocked', reason: 'accounting_completion_unverified' });
    expect(mocks.main).not.toHaveBeenCalled();
  });

  it('requires matching main-ledger evidence even when the tenant credit is synced', async () => {
    mocks.main.mockResolvedValueOnce([]);
    expect(await recoverShopifyRefundDownstreamEffects(refundInput))
      .toEqual({ status: 'blocked', reason: 'accounting_completion_unverified' });
  });

  it('reports a sanitized retry when the main completion ledger is unavailable', async () => {
    mocks.main.mockRejectedValueOnce(new Error('raw accounting database secret'));
    expect(await recoverShopifyRefundDownstreamEffects(refundInput))
      .toEqual({ status: 'retry', reason: 'refund_downstream_effects_failed' });
    expect(mocks.report).toHaveBeenCalled();
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('secret');
  });

  it('accepts explicit policy not-required without demanding a Xero ID', async () => {
    mocks.recoverRefund.mockResolvedValueOnce({
      outcome: 'duplicate', creditNoteId: 81, accounting: { status: 'not_required', reason: 'policy_disabled' },
    });
    expect(await recoverShopifyRefundDownstreamEffects(refundInput)).toEqual({ status: 'completed' });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.main).not.toHaveBeenCalled();
  });

  it('verifies refund projection on replay instead of acknowledging skipped linkage', async () => {
    mocks.mutation.mockResolvedValue({ accountId: 2 });
    mocks.project.mockResolvedValueOnce({ status: 'skipped', reason: 'shopify_not_linked' });
    expect(await recoverShopifyRefundDownstreamEffects(refundInput))
      .toEqual({ status: 'blocked', reason: 'loyalty_projection_shopify_not_linked' });
    expect(mocks.mutation).toHaveBeenCalledWith('business-1', 'shopify:instance-2:refund:7001:earn');
    expect(mocks.project).toHaveBeenCalledWith({ ...identity, contactId: 42 });
    expect(await recoverShopifyRefundDownstreamEffects(refundInput)).toEqual({ status: 'completed' });
  });

  it('sanitizes operational exceptions and blocks changed local receipts', async () => {
    mocks.recoverRefund.mockRejectedValueOnce(new Error('raw provider response secret'));
    expect(await recoverShopifyRefundDownstreamEffects(refundInput)).toMatchObject({ status: 'retry' });
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('secret');
    mocks.recoverRefund.mockResolvedValueOnce({ outcome: 'refunded', creditNoteId: 82 });
    expect(await recoverShopifyRefundDownstreamEffects(refundInput))
      .toEqual({ status: 'blocked', reason: 'completed_credit_note_changed' });
  });
});
