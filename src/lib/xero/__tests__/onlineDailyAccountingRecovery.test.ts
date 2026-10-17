import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedOnlineDailySales } from '../onlineDailySalesSync';
import type { DailySalesBatch, OnlineAccountingRecoveryGuard } from '@/services/XeroSyncService';

const mocks = vi.hoisted(() => ({
  imsQuery: vi.fn(), imsExecute: vi.fn(), getIMSPool: vi.fn(), query: vi.fn(), execute: vi.fn(),
  prepare: vi.fn(), sync: vi.fn(), gift: vi.fn(), accounts: vi.fn(), tracking: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/db/BusinessRegistry', () => ({ runImsForBusiness: (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn().mockResolvedValue('Australia/Sydney') }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute, getIMSPool: mocks.getIMSPool }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));
vi.mock('../onlineDailySalesSync', () => ({
  prepareOnlineDailySalesDay: mocks.prepare,
  OnlineDailySalesPreparationBlockedError: class extends Error { constructor(public reason: string) { super(reason); } },
}));
vi.mock('@/services/XeroSyncService', () => ({
  syncDailySalesBatch: mocks.sync, syncGiftCardLiabilityReclass: mocks.gift,
  getAccountMappings: mocks.accounts, getTrackingMappings: mocks.tracking,
  getTrackingForLocation: () => [],
  OnlineAccountingReviewRequiredError: class extends Error {},
}));

import {
  assertOnlineDailyAccountingReady, getOnlineDailyAccountingReadiness,
  onlineDailyAccountingInputHash, onlineAccountingRateLimitRetry, runOnlineDailyAccountingRecovery,
} from '../onlineDailyAccountingRecovery';

const input = { businessId: 'business-1', channelInstanceId: 'channel-1', date: '2026-10-15' };
let batch: Record<string, unknown>;
let control: { rollout_state: string; paused: number };
let channel: { provider: string; is_enabled: number; settings_json: Record<string, unknown> };
let coverage: Record<string, unknown>;
let dirty: { generation: string; propagated_generation: string | null; review_reason: string | null } | null;
let orderReview: unknown[];
let receipts: Record<string, unknown>[];
let fees: Record<string, unknown>[];
let giftId: string | null;
let historicalId: string | null;
let busy: boolean;
let lost: boolean;
let prepared: PreparedOnlineDailySales;
let business: { deleted_at: string | null; automation_paused: number };
let nativeIncomplete: { id: number }[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T03:00:00Z'));
  batch = {
    xero_invoice_id: null, invoice_status: 'pending', sync_status: 'pending',
    sync_required_through: '2026-10-16T04:00:00.000Z', sync_input_hash: null, sync_input_json: null,
    sync_stages_json: null, sync_source_generation: null, sync_review_reason: null,
  };
  control = { rollout_state: 'cutover', paused: 0 };
  mocks.getIMSPool.mockReturnValue({ getConnection: async () => ({
    beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined,
    release: () => undefined, execute: async () => [[control]],
  }) });
  business = { deleted_at: null, automation_paused: 0 };
  nativeIncomplete = [];
  channel = { provider: 'shopify', is_enabled: 1, settings_json: { shopify: { orders: { syncFrom: '2026-10-01' }, xero: { dailyAutoSyncEnabled: true } } } };
  coverage = { baseline_from: '2026-09-30T00:00:00Z', baseline_complete: 1, covered_through: '2026-10-17T02:00:00Z', continuation_json: null };
  dirty = null; orderReview = []; receipts = []; fees = []; giftId = null; historicalId = null; busy = false; lost = false;
  prepared = {
    totals: { xeroId: null, totalSales: 110, totalTax: 10, giftCardAmount: 0, orderCount: 1 },
    batch: { date: input.date, channel: 'online', channelInstanceId: input.channelInstanceId, totalSales: 100, totalTax: 10, lineDescription: 'Online sales', invoiceStatus: 'AUTHORISED', payoutManaged: true, gatewayAllocations: [{ gateway: 'shopify_payments', amount: 110, payoutManaged: true }] },
    orderEvidence: [{ sales_channel: 'shopify', native_checkout_id: null, shopify_order_id: '123', shopify_order_name: '#123', payment_gateway: 'shopify_payments', total_amount: '110', tax_amount: '10' }],
    policy: { postingEnabled: true, onlineBatchAction: 'authorised', paymentSyncEnabled: true, giftCardAccountingEnabled: true },
  };
  mocks.prepare.mockImplementation(async () => structuredClone(prepared));
  mocks.accounts.mockResolvedValue({ sales_revenue: '200', gift_card_liability: '800' });
  mocks.tracking.mockResolvedValue([]);
  mocks.report.mockResolvedValue(null);
  mocks.imsQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('ims_online_sync_control')) return [control];
    if (sql.includes('ims_shopify_reconciliation')) return [coverage];
    if (sql.includes('ims_online_day_changes')) return dirty ? [structuredClone(dirty)] : [];
    if (sql.includes('ims_shopify_order_recovery')) return orderReview;
    if (sql.includes('FROM ims_sales_orders')) return nativeIncomplete;
    throw new Error(`Unexpected tenant query: ${sql}`);
  });
  mocks.imsExecute.mockImplementation(async (_sql: string, values: unknown[]) => {
    if (dirty && values.at(-1) === dirty.generation) dirty.propagated_generation = String(values[0]);
    return { affectedRows: 1 };
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM businesses')) return [business];
    if (sql.includes('sales_channel_instances')) return [channel];
    if (sql.includes('xero_online_batches')) return [structuredClone(batch)];
    if (sql.includes('xero_online_order_payments')) return receipts;
    if (sql.includes('xero_online_order_fees')) return fees;
    if (sql.includes('xero_sync_log')) {
      if (sql.includes("sync_type = 'online_batch'")) return historicalId ? [{ xero_id: historicalId }] : [];
      return giftId ? [{ xero_id: giftId }] : [];
    }
    throw new Error(`Unexpected main query: ${sql}`);
  });
  mocks.execute.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes('sync_lease_token = ?') && sql.includes("sync_status = 'processing'")) return { affectedRows: busy ? 0 : 1 };
    if (lost && sql.includes('sync_lease_expires_at > UTC_TIMESTAMP(3)')) return { affectedRows: 0 };
    if (sql.includes('SET sync_input_hash')) {
      [batch.sync_input_hash, batch.sync_input_json, batch.sync_stages_json] = values;
    } else if (sql.includes('SET sync_status = ?')) {
      batch.sync_status = values[0];
      batch.sync_stages_json = values[1];
      if (values[3] && !batch.sync_review_reason) batch.sync_review_reason = values[3];
    } else if (sql.includes('sync_source_generation = ?')) {
      if (!batch.sync_review_reason) {
        batch.sync_review_reason = values[0] ?? (batch.xero_invoice_id && batch.sync_source_generation !== values[1] ? 'posted_day_changed' : null);
      }
      batch.sync_source_generation = values[2];
    } else if (sql.includes('SET xero_invoice_id = COALESCE')) batch.xero_invoice_id = values[0];
    return { affectedRows: 1 };
  });
  mocks.sync.mockImplementation(async (_businessId: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
    if (!batch.xero_invoice_id) {
      await guard.beforeMutation('invoice');
      batch.xero_invoice_id = 'invoice-1';
      batch.invoice_status = 'AUTHORISED';
    }
    return batch.xero_invoice_id;
  });
  mocks.gift.mockImplementation(async (args: { recovery: OnlineAccountingRecoveryGuard }) => {
    await args.recovery.beforeMutation('gift_card_liability');
    giftId = 'journal-1';
    return giftId;
  });
});
afterEach(() => vi.useRealTimers());

describe('daily accounting readiness', () => {
  it('leaves legacy and validation businesses on their existing route', async () => {
    for (const state of ['legacy', 'validation']) {
      control.rollout_state = state;
      expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ active: false, reason: 'legacy' });
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('retains compatibility only for a genuinely missing rollout table, not arbitrary database failures', async () => {
    mocks.imsQuery.mockRejectedValueOnce({ code: 'ER_NO_SUCH_TABLE' });
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ active: false });
    mocks.imsQuery.mockRejectedValueOnce({ code: 'ECONNRESET' });
    await expect(getOnlineDailyAccountingReadiness(input)).rejects.toEqual({ code: 'ECONNRESET' });
  });
  it.each([
    ['baseline_incomplete', { baseline_complete: 0 }],
    ['reconciliation_incomplete', { covered_through: '2026-10-15T00:00:00Z' }],
    ['reconciliation_in_progress', { continuation_json: '{}' }],
  ])('blocks %s', async (reason, partial) => {
    Object.assign(coverage, partial);
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ active: true, ready: false, reason });
    await expect(assertOnlineDailyAccountingReady(input)).rejects.toThrow(reason);
  });
  it('refuses stale completed coverage after the configured import date moves earlier', async () => {
    channel.settings_json = { shopify: { orders: { syncFrom: '2026-09-01' }, xero: { dailyAutoSyncEnabled: true } } };
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'rebaseline_required' });
    await expect(assertOnlineDailyAccountingReady({ ...input, manual: true })).rejects.toThrow('rebaseline_required');
    expect(await runOnlineDailyAccountingRecovery({ ...input, manual: true })).toMatchObject({ status: 'blocked', reason: 'rebaseline_required' });
    expect(mocks.imsExecute).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('accepts only baselines at or before the conservative configured UTC-minus-one-day bound', async () => {
    coverage.baseline_from = '2026-09-30T00:00:00.001Z';
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'rebaseline_required' });
    coverage.baseline_from = new Date('2026-09-30T00:00:00.000Z');
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: true });
    coverage.baseline_from = '2026-08-01T00:00:00Z';
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: true });
  });
  it('does not infer complete coverage from a missing stored baseline or missing current configuration', async () => {
    coverage.baseline_from = null;
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'rebaseline_required' });
    channel.settings_json = { shopify: { xero: { dailyAutoSyncEnabled: true } } };
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'reconciliation_configuration_incomplete' });
  });
  it.each(['shopify', 'native_shop'])('rejects propagated durable dirty-day review for %s despite complete coverage', async provider => {
    channel.provider = provider;
    dirty = { generation: 'review-generation', propagated_generation: 'review-generation', review_reason: 'source_conflict' };
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'source_conflict', reviewRequired: true });
    expect(await runOnlineDailyAccountingRecovery({ ...input, manual: true })).toMatchObject({ status: 'review', reason: 'source_conflict' });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('rejects sticky order quarantine even when the order was applied and interval coverage advanced', async () => {
    orderReview = [{ external_order_id: '123', review_reason: 'provider_version_conflict', applied_hash: 'already-applied', lease_expires_at: null }];
    expect(await getOnlineDailyAccountingReadiness({ ...input, manual: true })).toMatchObject({ ready: false, reason: 'order_review_required' });
    expect(mocks.imsQuery.mock.calls.find(([sql]) => sql.includes('FROM ims_shopify_order_recovery'))?.[0]).toContain('review_reason IS NOT NULL');
    expect(await runOnlineDailyAccountingRecovery({ ...input, manual: true })).toMatchObject({ status: 'blocked', reason: 'order_review_required' });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('never consults Shopify state for a native storefront', async () => {
    channel.provider = 'native_shop';
    coverage.baseline_complete = 0;
    orderReview = [{ external_order_id: 'bad-shopify-order' }];
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: true, provider: 'native_shop' });
    expect(mocks.imsQuery.mock.calls.some(([sql]) => sql.includes('ims_shopify'))).toBe(false);
  });
  it('blocks unpaid native orders using only native receipt evidence', async () => {
    channel.provider = 'native_shop';
    nativeIncomplete = [{ id: 1 }];
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'native_payment_evidence_incomplete' });
    expect(mocks.imsQuery.mock.calls.some(([sql]) => sql.includes('ims_shopify'))).toBe(false);
  });
  it('does not allow a stale scheduled job to bypass disabled automatic accounting', async () => {
    channel.settings_json = { shopify: { orders: { syncFrom: '2026-10-01' } } };
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ ready: false, reason: 'automatic_accounting_disabled' });
    expect(await getOnlineDailyAccountingReadiness({ ...input, manual: true })).toMatchObject({ ready: true });
  });
  it('rejects another owner or a disabled storefront', async () => {
    channel.is_enabled = 0;
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'channel_unavailable' });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('BINARY business_id'), [input.businessId, input.channelInstanceId]);
  });
  it('requires a completed local business day and respects pause', async () => {
    expect(await getOnlineDailyAccountingReadiness({ ...input, date: '2026-10-17' })).toMatchObject({ reason: 'business_day_open' });
    control.paused = 1;
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'paused' });
  });
  it('blocks deleted and globally paused businesses independently of dispatch', async () => {
    business.deleted_at = '2026-10-16';
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'business_unavailable' });
    business.deleted_at = null; business.automation_paused = 1;
    expect(await getOnlineDailyAccountingReadiness({ ...input, manual: true })).toMatchObject({ reason: 'business_automation_paused' });
  });
  it('blocks unresolved order effects without treating them as coverage', async () => {
    orderReview = [{ external_order_id: '123' }];
    expect(await getOnlineDailyAccountingReadiness(input)).toMatchObject({ reason: 'order_review_required' });
  });
  it('never moves the frozen barrier forward on repeated manual requests', async () => {
    const first = await getOnlineDailyAccountingReadiness(input);
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'));
    expect((await getOnlineDailyAccountingReadiness(input)).requiredThrough).toBe(first.requiredThrough);
    expect(mocks.execute.mock.calls[0][0]).toContain('COALESCE(sync_required_through');
  });
  it('rejects invalid calendar dates before storage access', async () => {
    await expect(getOnlineDailyAccountingReadiness({ ...input, date: '2026-02-30' })).rejects.toThrow('valid accounting date');
    expect(mocks.imsQuery).not.toHaveBeenCalled();
  });
});

describe('staged durable accounting', () => {
  it('freezes evidence, posts once and completes only required stages', async () => {
    const result = await runOnlineDailyAccountingRecovery(input);
    expect(result).toMatchObject({ status: 'completed', xeroId: 'invoice-1', stages: {
      invoice: { state: 'completed' }, payments: { state: 'not_required' }, fees: { state: 'not_required' }, gift_card_liability: { state: 'not_required' },
    } });
    expect(batch.sync_input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it('blocks disabled posting without posting or freezing a misleading completed snapshot', async () => {
    prepared.policy.postingEnabled = false;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'posting_policy_disabled' });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(batch.sync_input_json).toBeNull();
  });
  it('preserves draft document policy and does not invent payment stages', async () => {
    prepared.policy.onlineBatchAction = 'draft';
    prepared.policy.paymentSyncEnabled = false;
    prepared.batch!.invoiceStatus = 'DRAFT';
    mocks.sync.mockImplementationOnce(async (_id: string, passed: DailySalesBatch, guard: OnlineAccountingRecoveryGuard) => {
      expect(passed.invoiceStatus).toBe('DRAFT');
      await guard.beforeMutation('invoice');
      batch.xero_invoice_id = 'draft-1'; batch.invoice_status = 'DRAFT';
      return 'draft-1';
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed', xeroId: 'draft-1' });
  });
  it('propagates dirty evidence to main before acknowledging tenant state or posting', async () => {
    dirty = { generation: 'generation-1', propagated_generation: null, review_reason: null };
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(batch.sync_source_generation).toBe('generation-1');
    expect(dirty.propagated_generation).toBe('generation-1');
    expect(mocks.execute.mock.invocationCallOrder.find((_, i) => mocks.execute.mock.calls[i][0].includes('sync_source_generation'))!)
      .toBeLessThan(mocks.imsExecute.mock.invocationCallOrder[0]);
    expect(mocks.imsExecute.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
  });
  it('flags a newly found financial generation on posted days even when net totals match', async () => {
    await runOnlineDailyAccountingRecovery(input);
    dirty = { generation: 'new-financial-lines', propagated_generation: null, review_reason: null };
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review' });
    expect(batch.sync_review_reason).toBe('posted_day_changed');
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it('retains the posted snapshot and flags financial changes arriving during provider posting', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      await guard.beforeMutation('invoice');
      batch.xero_invoice_id = 'invoice-1'; batch.invoice_status = 'AUTHORISED';
      dirty = { generation: 'arrived-during-posting', propagated_generation: null, review_reason: null };
      return 'invoice-1';
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review' });
    expect(batch.sync_review_reason).toBe('posted_day_changed');
    expect(batch.sync_input_json).not.toBeNull();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it('idempotently retries propagation after main succeeded and tenant acknowledgement failed', async () => {
    dirty = { generation: 'same-generation', propagated_generation: null, review_reason: null };
    batch.sync_source_generation = 'same-generation';
    await runOnlineDailyAccountingRecovery(input);
    dirty.propagated_generation = null;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(batch.sync_review_reason).toBeNull();
  });
  it('does not fabricate a snapshot or replace an existing invoice', async () => {
    batch.xero_invoice_id = 'legacy-invoice'; batch.invoice_status = 'AUTHORISED';
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'legacy_input_unverified' });
    expect(batch.sync_input_json).toBeNull();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('adopts canonical successful historical identity but holds unknown legacy inputs for review', async () => {
    historicalId = 'known-historical-invoice';
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'legacy_input_unverified' });
    expect(batch.xero_invoice_id).toBe('known-historical-invoice');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('detects GST, gateway, identity and liability changes even with unchanged gross sales', async () => {
    await runOnlineDailyAccountingRecovery(input);
    const snapshot = batch.sync_input_json;
    prepared.orderEvidence[0].payment_gateway = 'paypal';
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'accounting_input_changed' });
    expect(batch.sync_input_json).toBe(snapshot);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
  it('cannot claim another worker ownership or checkpoint after its lease expires', async () => {
    busy = true;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'accounting_busy' });
    expect(mocks.sync).not.toHaveBeenCalled();
    busy = false;
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => { lost = true; await guard.beforeMutation('invoice'); });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'lease_lost' });
    expect(batch.sync_status).not.toBe('completed');
  });
  it('does not mistake an invoice ID for completed payments, fees or gift-card liability', async () => {
    prepared.batch!.clearingPayments = [{ accountCode: '091', amount: 110, label: 'stripe', paymentKey: 'order-1', fee: { accountCode: '400', amount: 1.5, gatewayName: 'Stripe', taxType: 'INPUT' } }];
    prepared.totals.giftCardAmount = 20;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'accounting_stages_incomplete',
      stages: { invoice: { state: 'completed' }, payments: { state: 'pending' }, fees: { state: 'pending' }, gift_card_liability: { state: 'pending' } } });
    expect(mocks.gift).not.toHaveBeenCalled();
  });
  it('resumes liability independently after confirmed invoice/payment stages', async () => {
    prepared.totals.giftCardAmount = 20;
    const result = await runOnlineDailyAccountingRecovery(input);
    expect(result).toMatchObject({ status: 'completed', stages: { gift_card_liability: { state: 'completed', xeroId: 'journal-1' } } });
    expect(mocks.gift).toHaveBeenCalledTimes(1);
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
    expect(mocks.gift).toHaveBeenCalledTimes(1);
  });
  it('requires confirmed provider IDs, not completed ledger status alone', async () => {
    prepared.batch!.clearingPayments = [{ accountCode: '091', amount: 110, label: 'stripe', paymentKey: 'order-1' }];
    receipts = [{ payment_key: 'order-1', status: 'completed', xero_payment_id: null, amount: '110', account_code: '091', xero_invoice_id: 'invoice-1' }];
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', stages: { payments: { state: 'pending' } } });
  });
  it('verifies amounts, account mappings and invoice ownership on completed receipts', async () => {
    prepared.batch!.clearingPayments = [{ accountCode: '091', amount: 110, label: 'stripe', paymentKey: 'order-1' }];
    receipts = [{ payment_key: 'order-1', status: 'completed', xero_payment_id: 'payment-1', amount: '110', account_code: '091', xero_invoice_id: 'another-invoice' }];
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry' });
    receipts[0].xero_invoice_id = 'invoice-1';
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed', stages: { payments: { state: 'completed' } } });
  });
  it('requires separate confirmed fee evidence even after the gross receipt is complete', async () => {
    prepared.batch!.clearingPayments = [{ accountCode: '091', amount: 110, label: 'stripe', paymentKey: 'order-1', fee: { accountCode: '400', amount: 1.5, gatewayName: 'Stripe', taxType: 'INPUT' } }];
    receipts = [{ payment_key: 'order-1', status: 'completed', xero_payment_id: 'payment-1', amount: '110', account_code: '091', xero_invoice_id: 'invoice-1' }];
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', stages: { payments: { state: 'completed' }, fees: { state: 'pending' } } });
    fees = [{ fee_key: 'order-1-fee', status: 'completed', xero_bank_transaction_id: 'fee-1', fee_amount: '1.5', fee_account_code: '400', bank_account_code: '091', fee_tax_type: 'INPUT' }];
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed', stages: { fees: { state: 'completed' } } });
  });
  it('does not treat a returned liability helper ID as durable completion without success evidence', async () => {
    prepared.totals.giftCardAmount = 20;
    mocks.gift.mockResolvedValueOnce('unpersisted-journal');
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', stages: { gift_card_liability: { state: 'pending' } } });
  });
  it('retains ambiguous external results for review instead of replaying provider writes', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      await guard.beforeMutation('invoice');
      throw new Error('provider accepted but response was lost');
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review', reason: 'external_result_unconfirmed' });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'review' });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ businessId: input.businessId, context: { channelInstanceId: input.channelInstanceId, date: input.date } }));
  });
  it('retries read failures before provider mutation without fabricating completion', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('read failed'));
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'operational_failure' });
    expect(batch.sync_status).toBe('retry');
  });
  it('rechecks automatic accounting immediately before each financial mutation', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      channel.settings_json = {};
      await guard.beforeMutation('invoice');
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'automatic_accounting_disabled' });
    expect(batch.xero_invoice_id).toBeNull();
  });
  it('rechecks global deletion and automation pause immediately before provider mutations', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      business.automation_paused = 1;
      await guard.beforeMutation('invoice');
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'business_automation_paused' });
    expect(batch.xero_invoice_id).toBeNull();
  });
  it('retries definite rate limits with their Retry-After delay instead of treating them as ambiguous writes', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      await guard.beforeMutation('invoice');
      throw Object.assign(new Error('rate limited'), { status: 429, retryAfterSeconds: 300 });
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'provider_rate_limit', retryAfterSeconds: 300 });
    expect(batch.sync_review_reason).toBeNull();
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'completed' });
  });
  it('returns a retry continuation rather than an operational failure when the stage budget is exhausted', async () => {
    mocks.sync.mockImplementationOnce(async (_id: string, _batch: unknown, guard: OnlineAccountingRecoveryGuard) => {
      vi.advanceTimersByTime(45_001);
      await guard.beforeMutation('invoice');
    });
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'retry', reason: 'invocation_budget' });
    expect(batch.xero_invoice_id).toBeNull();
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('blocks empty days rather than recording a successful posting', async () => {
    prepared.totals.totalSales = 0; prepared.batch = null;
    expect(await runOnlineDailyAccountingRecovery(input)).toMatchObject({ status: 'blocked', reason: 'no_sales' });
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

describe('accounting input fingerprint', () => {
  it('normalises object key ordering but retains amounts and source order identities', () => {
    expect(onlineDailyAccountingInputHash({ total: 110, tax: 10 })).toBe(onlineDailyAccountingInputHash({ tax: 10, total: 110 }));
    expect(onlineDailyAccountingInputHash({ total: 110, tax: 10 })).not.toBe(onlineDailyAccountingInputHash({ total: 110, tax: 0 }));
    expect(onlineDailyAccountingInputHash(['order-a'])).not.toBe(onlineDailyAccountingInputHash(['order-b']));
  });
  it('distinguishes provider rate limits and honours seconds/date headers without classifying transport failures', () => {
    expect(onlineAccountingRateLimitRetry(new Error('network timed out'))).toBeNull();
    expect(onlineAccountingRateLimitRetry({ status: 500, retryAfterSeconds: 300 })).toBeNull();
    expect(onlineAccountingRateLimitRetry({ status: 429, retryAfter: '120' })).toBe(120);
    expect(onlineAccountingRateLimitRetry({ status: 429, retryAfter: 'Sat, 17 Oct 2026 03:05:00 GMT' }, Date.parse('2026-10-17T03:00:00Z'))).toBe(300);
    expect(onlineAccountingRateLimitRetry(new Error('Xero API POST /Invoices failed (429): rate limited'))).toBe(60);
  });
});
