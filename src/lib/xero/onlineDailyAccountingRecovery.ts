import { createHash, randomUUID } from 'node:crypto';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { OnlineSyncLeaseLostError } from '@/lib/channels/onlineSyncPolicy';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { isXeroAccountingDisabledError } from '@/lib/ims/businessOperations';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';
import type { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '@/services/MySQLService';
import {
  getAccountMappings, getTrackingMappings, getTrackingForLocation,
  OnlineAccountingReviewRequiredError, syncDailySalesBatch, syncGiftCardLiabilityReclass,
  type OnlineAccountingRecoveryGuard,
} from '@/services/XeroSyncService';
import { OnlineDailySalesPreparationBlockedError, prepareOnlineDailySalesDay, type PreparedOnlineDailySales } from './onlineDailySalesSync';

export interface OnlineDailyAccountingInput {
  businessId: string;
  channelInstanceId: string;
  date: string;
  manual?: boolean;
}
export interface OnlineDailyAccountingReadiness {
  active: boolean;
  ready: boolean;
  reason: string;
  provider?: 'shopify' | 'native_shop';
  requiredThrough?: string;
  reviewRequired?: boolean;
}
export type OnlineDailyAccountingStages = Record<string, {
  state: 'pending' | 'unconfirmed' | 'completed' | 'not_required';
  xeroId?: string;
}>;
export interface OnlineDailyAccountingOutcome {
  status: 'completed' | 'retry' | 'blocked' | 'review';
  reason: string;
  xeroId?: string | null;
  stages?: OnlineDailyAccountingStages;
  retryAfterSeconds?: number;
}
interface BatchRow {
  xero_invoice_id: string | null;
  invoice_status: string;
  sync_status: string;
  sync_required_through: Date | string | null;
  sync_input_hash: string | null;
  sync_input_json: FrozenInput | string | null;
  sync_stages_json: OnlineDailyAccountingStages | string | null;
  sync_source_generation: string | null;
  sync_review_reason: string | null;
  sync_attempts: number;
}
interface FrozenInput {
  version: 1;
  prepared: PreparedOnlineDailySales;
  revenueAccountCode: string;
  liabilityAccountCode: string | null;
  tracking: ReturnType<typeof getTrackingForLocation>;
}
interface DayChange { generation: string; propagated_generation: string | null; review_reason: string | null }
class OnlineAccountingSliceExhaustedError extends Error {}

const ownerWhere = 'BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ? AND batch_date = ?';
const leaseWhere = `${ownerWhere} AND sync_lease_token = ? AND sync_lease_expires_at > UTC_TIMESTAMP(3)`;
const params = (input: OnlineDailyAccountingInput) => [input.businessId, input.channelInstanceId, input.date];

function validate(input: OnlineDailyAccountingInput): void {
  if (!input.businessId.trim() || input.businessId !== input.businessId.trim() || input.businessId.length > 100
    || !input.channelInstanceId.trim() || input.channelInstanceId !== input.channelInstanceId.trim() || input.channelInstanceId.length > 36
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
    || !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`))
    || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) {
    throw new Error('Exact business, channel instance and valid accounting date are required.');
  }
}
function json<T>(value: T | string | null): T | null {
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}
function iso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString();
}

/** Stable object-key ordering; array order is part of the frozen accounting contract. */
export function onlineDailyAccountingInputHash(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return item;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Accept only a definite rate-limit response, never a transport/5xx failure after a mutation. */
export function onlineAccountingRateLimitRetry(error: unknown, now = Date.now()): number | null {
  if (!error || typeof error !== 'object') return null;
  const response = error as { status?: unknown; statusCode?: unknown; message?: unknown; retryAfterSeconds?: unknown; retryAfter?: unknown };
  const legacy429 = typeof response.message === 'string' && /^Xero API (?:POST|GET) \S+ failed \(429\):/.test(response.message);
  if (response.status !== 429 && response.statusCode !== 429 && !legacy429) return null;
  const seconds = Number(response.retryAfterSeconds);
  if (response.retryAfterSeconds != null && Number.isFinite(seconds) && seconds >= 0) return Math.max(60, Math.ceil(seconds));
  if (typeof response.retryAfter === 'string') {
    const headerSeconds = /^\d+$/.test(response.retryAfter) ? Number(response.retryAfter)
      : (Date.parse(response.retryAfter) - now) / 1000;
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return Math.max(60, Math.ceil(headerSeconds));
  }
  return 60;
}

async function batchRow(input: OnlineDailyAccountingInput): Promise<BatchRow> {
  const rows = await query<BatchRow>(`SELECT * FROM xero_online_batches WHERE ${ownerWhere} LIMIT 1`, params(input));
  if (!rows[0]) throw new Error('Canonical accounting state is missing.');
  return rows[0];
}
async function dayChange(input: OnlineDailyAccountingInput): Promise<DayChange | null> {
  const rows = await imsQuery<DayChange>(
    `SELECT generation, propagated_generation, review_reason FROM ims_online_day_changes
      WHERE BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ? AND business_date = ?`,
    params(input),
  );
  return rows[0] ?? null;
}

/** Freezes a request-time barrier once. No order imports, overrides, or provider calls. */
export async function getOnlineDailyAccountingReadiness(
  input: OnlineDailyAccountingInput,
): Promise<OnlineDailyAccountingReadiness> {
  validate(input);
  return runImsForBusiness(input.businessId, async () => {
    let controls: { rollout_state: string; paused: number }[];
    try {
      controls = await imsQuery(`SELECT rollout_state, paused FROM ims_online_sync_control WHERE BINARY business_id = BINARY ?`, [input.businessId]);
    } catch (error) {
      // Unmigrated businesses retain legacy behaviour; other storage failures must fail closed.
      if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return { active: false, ready: false, reason: 'legacy' };
      throw error;
    }
    if (controls[0]?.rollout_state !== 'cutover') return { active: false, ready: false, reason: 'legacy' };
    const blocked = (reason: string): OnlineDailyAccountingReadiness => ({ active: true, ready: false, reason });
    if (controls[0].paused) return blocked('paused');
    const businesses = await query<{ deleted_at: string | Date | null; automation_paused: number }>(
      `SELECT deleted_at, automation_paused FROM businesses WHERE BINARY business_id = BINARY ? LIMIT 1`,
      [input.businessId],
    );
    if (!businesses[0] || businesses[0].deleted_at) return blocked('business_unavailable');
    if (businesses[0].automation_paused) return blocked('business_automation_paused');
    const channels = await query<{ provider: string; is_enabled: number; settings_json: Record<string, unknown> | string | null }>(
      `SELECT provider, is_enabled, settings_json FROM sales_channel_instances
        WHERE BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ?
          AND runtime_status = 'active' AND readiness_status = 'ready' LIMIT 1`,
      [input.businessId, input.channelInstanceId],
    );
    const channel = channels[0];
    if (!channel?.is_enabled || !['shopify', 'native_shop'].includes(channel.provider)) return blocked('channel_unavailable');
    const provider = channel.provider as 'shopify' | 'native_shop';
    if (provider === 'shopify' && input.manual !== true
      && !shopifyInstanceSettings(json(channel.settings_json) ?? {}).xero.dailyAutoSyncEnabled) {
      return { ...blocked('automatic_accounting_disabled'), provider };
    }
    const timeZone = await getBusinessTimeZone(input.businessId);
    if (input.date >= new Date().toLocaleDateString('sv-SE', { timeZone })) return blocked('business_day_open');
    await execute(
      `INSERT INTO xero_online_batches (business_id, channel_instance_id, batch_date, sync_required_through)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE sync_required_through = COALESCE(sync_required_through, VALUES(sync_required_through))`,
      params(input),
    );
    const batch = await batchRow(input);
    const requiredThrough = iso(batch.sync_required_through!);
    if (batch.sync_review_reason) return { ...blocked(batch.sync_review_reason), provider, requiredThrough, reviewRequired: true };
    const change = await dayChange(input);
    if (change?.review_reason) return { ...blocked(change.review_reason), provider, requiredThrough, reviewRequired: true };
    if (provider === 'shopify') {
      const reconciliation = await imsQuery<{ baseline_from: Date | string | null; baseline_complete: number; covered_through: Date | string | null; continuation_json: unknown }>(
        `SELECT baseline_from, baseline_complete, covered_through, continuation_json FROM ims_shopify_reconciliation
          WHERE BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ?`,
        [input.businessId, input.channelInstanceId],
      );
      const coverage = reconciliation[0];
      if (!coverage?.baseline_complete) return { ...blocked('baseline_incomplete'), provider, requiredThrough };
      const syncFrom = shopifyInstanceSettings(json(channel.settings_json) ?? {}).orders.syncFrom;
      const configuredStart = syncFrom && /^\d{4}-\d{2}-\d{2}$/.test(syncFrom) ? Date.parse(`${syncFrom}T00:00:00.000Z`) : NaN;
      if (!Number.isFinite(configuredStart) || new Date(configuredStart).toISOString().slice(0, 10) !== syncFrom) {
        return { ...blocked('reconciliation_configuration_incomplete'), provider, requiredThrough };
      }
      // Baselines start one UTC day early to cover all supported business-timezone boundaries.
      // Moving the configured date earlier requires an explicit rebaseline, never a silent reset.
      if (!coverage.baseline_from || Date.parse(iso(coverage.baseline_from)) > configuredStart - 86_400_000) {
        return { ...blocked('rebaseline_required'), provider, requiredThrough };
      }
      if (!coverage.covered_through || iso(coverage.covered_through) < requiredThrough) {
        return { ...blocked('reconciliation_incomplete'), provider, requiredThrough };
      }
      // A newer in-flight interval may be discovering relevant changes. Conservatively wait.
      if (coverage.continuation_json) return { ...blocked('reconciliation_in_progress'), provider, requiredThrough };
      const review = await imsQuery(
        `SELECT external_order_id FROM ims_shopify_order_recovery
          WHERE BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ?
            AND (review_reason IS NOT NULL OR lease_expires_at > UTC_TIMESTAMP(3))
          LIMIT 1`,
        [input.businessId, input.channelInstanceId],
      );
      if (review.length) return { ...blocked('order_review_required'), provider, requiredThrough };
    } else {
      const incompleteReceipts = await imsQuery<{ id: number }>(
        `SELECT so.id FROM ims_sales_orders so
          LEFT JOIN ims_sales_order_payments sop ON sop.so_id = so.id AND sop.business_id = so.business_id
          WHERE so.business_id = ? AND DATE_FORMAT(so.order_date, '%Y-%m-%d') = ?
            AND so.channel_instance_id = ? AND so.so_type = 'online' AND so.sales_channel = 'native_shop'
            AND COALESCE(so.is_staff_preview_test, 0) = 0
            AND (so.is_historical IS NULL OR so.is_historical = 0) AND so.status != 'cancelled'
          GROUP BY so.id
          HAVING ABS(COALESCE(SUM(sop.amount), 0) - MAX(so.total_amount)) > 0.01 OR COUNT(sop.id) = 0
          LIMIT 1`, [input.businessId, input.date, input.channelInstanceId],
      );
      if (incompleteReceipts.length) return { ...blocked('native_payment_evidence_incomplete'), provider, requiredThrough };
    }
    return { active: true, ready: true, reason: 'ready', provider, requiredThrough };
  });
}

export class OnlineDailyAccountingNotReadyError extends Error {
  constructor(public readonly readiness: OnlineDailyAccountingReadiness) {
    super(`Online accounting is not ready: ${readiness.reason}`);
  }
}
export async function assertOnlineDailyAccountingReady(input: OnlineDailyAccountingInput): Promise<OnlineDailyAccountingReadiness> {
  const readiness = await getOnlineDailyAccountingReadiness(input);
  if (!readiness.ready) throw new OnlineDailyAccountingNotReadyError(readiness);
  return readiness;
}

async function freezeInput(input: OnlineDailyAccountingInput): Promise<FrozenInput> {
  const prepared = await prepareOnlineDailySalesDay(input.businessId, input.date, input.channelInstanceId, { strictRecovery: true });
  const [accounts, tracking] = await Promise.all([getAccountMappings(input.businessId), getTrackingMappings(input.businessId)]);
  // Aggregate receipts also need durable stage evidence, using the original implicit Xero key.
  prepared.batch?.clearingPayments?.forEach((payment, index) => {
    payment.paymentKey ??= `${index}|${payment.accountCode}|${payment.amount.toFixed(2)}`;
  });
  return {
    version: 1, prepared,
    revenueAccountCode: accounts.sales_revenue ?? '',
    liabilityAccountCode: accounts.gift_card_liability ?? null,
    tracking: getTrackingForLocation(tracking, null, 'online'),
  };
}
function initialStages(frozen: FrozenInput): OnlineDailyAccountingStages {
  const payments = frozen.prepared.batch?.clearingPayments ?? [];
  const stages: OnlineDailyAccountingStages = {
    invoice: { state: 'pending' },
    payments: { state: payments.length ? 'pending' : 'not_required' },
    fees: { state: payments.some(p => p.fee && p.fee.amount > 0) ? 'pending' : 'not_required' },
    gift_card_liability: { state: frozen.prepared.totals.giftCardAmount > 0 && frozen.prepared.policy.giftCardAccountingEnabled ? 'pending' : 'not_required' },
    // Payouts and refund CNs have their own canonical owners; neither is a daily invoice payment.
    shopify_payouts: { state: 'not_required' },
  };
  payments.forEach(payment => {
    stages[`payment:${payment.paymentKey}`] = { state: 'pending' };
    if (payment.fee && payment.fee.amount > 0) stages[`fee:${payment.paymentKey}-fee`] = { state: 'pending' };
  });
  return stages;
}

/** A batch ID alone is never completion evidence for payments, fees or liability journals. */
async function verifyStages(input: OnlineDailyAccountingInput, frozen: FrozenInput, stages: OnlineDailyAccountingStages): Promise<void> {
  const required = initialStages(frozen);
  for (const [key, value] of Object.entries(required)) {
    stages[key] = stages[key]?.state === 'unconfirmed' ? { state: 'unconfirmed' } : value;
  }
  const batch = await batchRow(input);
  if (batch.xero_invoice_id && ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID'].includes(batch.invoice_status.toUpperCase())) {
    stages.invoice = { state: 'completed', xeroId: batch.xero_invoice_id };
  }
  const payments = frozen.prepared.batch?.clearingPayments ?? [];
  if (payments.length) {
    const rows = await query<{ payment_key: string; status: string; xero_payment_id: string | null; amount: string; account_code: string; xero_invoice_id: string }>(
      `SELECT payment_key, status, xero_payment_id, amount, account_code, xero_invoice_id FROM xero_online_order_payments
        WHERE ${ownerWhere}`, params(input),
    );
    const fees = await query<{ fee_key: string; status: string; xero_bank_transaction_id: string | null; fee_amount: string; fee_account_code: string; bank_account_code: string; fee_tax_type: string }>(
      `SELECT fee_key, status, xero_bank_transaction_id, fee_amount, fee_account_code, bank_account_code, fee_tax_type FROM xero_online_order_fees
        WHERE ${ownerWhere}`, params(input),
    );
    for (const payment of payments) {
      const receipt = rows.find(row => row.payment_key === payment.paymentKey);
      if (receipt?.status === 'completed' && receipt.xero_payment_id && receipt.xero_invoice_id === batch.xero_invoice_id
        && Number(receipt.amount) === payment.amount && receipt.account_code === payment.accountCode) {
        stages[`payment:${payment.paymentKey}`] = { state: 'completed', xeroId: receipt.xero_payment_id };
      }
      if (payment.fee && payment.fee.amount > 0) {
        const fee = fees.find(row => row.fee_key === `${payment.paymentKey}-fee`);
        if (fee?.status === 'completed' && fee.xero_bank_transaction_id && Number(fee.fee_amount) === payment.fee.amount
          && fee.fee_account_code === payment.fee.accountCode && fee.bank_account_code === payment.accountCode && fee.fee_tax_type === payment.fee.taxType) {
          stages[`fee:${payment.paymentKey}-fee`] = { state: 'completed', xeroId: fee.xero_bank_transaction_id };
        }
      }
    }
    if (payments.every(p => stages[`payment:${p.paymentKey}`].state === 'completed')) stages.payments = { state: 'completed' };
    if (payments.filter(p => p.fee && p.fee.amount > 0).every(p => stages[`fee:${p.paymentKey}-fee`].state === 'completed')
      && stages.fees.state !== 'not_required') stages.fees = { state: 'completed' };
  }
  if (stages.gift_card_liability.state !== 'not_required') {
    const logs = await query<{ xero_id: string }>(
      `SELECT xero_id FROM xero_sync_log WHERE BINARY business_id = BINARY ? AND sync_type = 'gift_card_liability'
        AND status = 'success' AND BINARY detail = BINARY ? AND xero_id IS NOT NULL LIMIT 1`,
      [input.businessId, `gift card liability online ${input.channelInstanceId} ${input.date}`],
    );
    if (logs[0]?.xero_id) stages.gift_card_liability = { state: 'completed', xeroId: logs[0].xero_id };
  }
}

/** Called only by the tenant-scoped durable dispatcher, or an authorised readiness-gated route. */
export async function runOnlineDailyAccountingRecovery(input: OnlineDailyAccountingInput): Promise<OnlineDailyAccountingOutcome> {
  validate(input);
  return runImsForBusiness(input.businessId, async () => {
    const startedAt = Date.now();
    let token: string | null = null;
    let stages: OnlineDailyAccountingStages | undefined;
    let frozen: FrozenInput | undefined;
    let retryAfterSeconds = 60;
    const checkpoint = async (status: string, reason: string | null = null) => {
      const completionFence = status === 'completed'
        ? ` AND EXISTS (SELECT 1 FROM businesses active_business
            WHERE BINARY active_business.business_id = BINARY ? AND active_business.deleted_at IS NULL
              AND COALESCE(active_business.automation_paused, 0) = 0)`
        : '';
      const save = () => execute(
        `UPDATE xero_online_batches SET sync_status = ?, sync_stages_json = COALESCE(?, sync_stages_json), sync_safe_error_code = ?,
          sync_review_reason = COALESCE(sync_review_reason, ?),
          sync_available_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
          WHERE ${leaseWhere}${completionFence}`,
        [status, stages ? JSON.stringify(stages) : null, reason, status === 'review' ? reason : null, retryAfterSeconds,
          ...params(input), token, ...(status === 'completed' ? [input.businessId] : [])],
      );
      let affectedRows: number;
      if (status === 'completed') {
        const connection = await getIMSPool().getConnection();
        try {
          // Serialize the short main-DB completion CAS with committed tenant pause/cutover changes.
          // Never hold this lock across a provider request.
          await connection.beginTransaction();
          const [controls] = await connection.execute<(RowDataPacket & { paused: number; rollout_state: string })[]>(
            `SELECT paused, rollout_state FROM ims_online_sync_control
              WHERE BINARY business_id = BINARY ? FOR UPDATE`, [input.businessId],
          );
          if (!controls[0] || controls[0].paused || controls[0].rollout_state !== 'cutover') {
            throw new OnlineDailyAccountingNotReadyError({
              active: controls[0]?.rollout_state === 'cutover', ready: false,
              reason: controls[0]?.paused ? 'paused' : 'legacy',
            });
          }
          affectedRows = (await save()).affectedRows;
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally { connection.release(); }
      } else {
        affectedRows = (await save()).affectedRows;
      }
      if (affectedRows !== 1) {
        if (status === 'completed') await assertOnlineDailyAccountingReady(input);
        throw new OnlineSyncLeaseLostError();
      }
    };
    const outcome = async (status: OnlineDailyAccountingOutcome['status'], reason: string): Promise<OnlineDailyAccountingOutcome> => {
      await checkpoint(status, status === 'completed' ? null : reason);
      if (reason === 'external_result_unconfirmed' || reason === 'accounting_stages_incomplete') {
        await reportRuntimeIssue({
          businessId: input.businessId, source: 'online_accounting_recovery', operation: 'verify_daily_accounting_stages',
          title: 'Online daily accounting stages remain unconfirmed',
          error: new Error(reason),
          context: { channelInstanceId: input.channelInstanceId, date: input.date },
          reference: { type: 'online_daily_accounting', id: `${input.channelInstanceId}:${input.date}` },
        });
      }
      return { status, reason, xeroId: stages?.invoice?.xeroId ?? null, stages,
        ...(status === 'retry' ? { retryAfterSeconds } : {}) };
    };
    try {
      const ready = await getOnlineDailyAccountingReadiness(input);
      if (!ready.ready) return { status: ready.reviewRequired ? 'review' : 'blocked', reason: ready.reason };
      token = randomUUID();
      const claimed = await execute(
        `UPDATE xero_online_batches SET sync_lease_token = ?, sync_lease_expires_at = TIMESTAMPADD(SECOND, 180, UTC_TIMESTAMP(3)),
          sync_status = 'processing', sync_attempts = sync_attempts + 1
          WHERE ${ownerWhere} AND sync_review_reason IS NULL
            AND (sync_lease_token IS NULL OR sync_lease_expires_at <= UTC_TIMESTAMP(3))`,
        [token, ...params(input)],
      );
      if (claimed.affectedRows !== 1) return { status: 'retry', reason: 'accounting_busy' };
      const assertOwnership = async () => {
        const renewed = await execute(
          `UPDATE xero_online_batches SET sync_lease_expires_at = TIMESTAMPADD(SECOND, 180, UTC_TIMESTAMP(3))
            WHERE ${leaseWhere}`, [...params(input), token],
        );
        if (renewed.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
      };
      const current = await batchRow(input);
      retryAfterSeconds = Math.min(3600, 60 * 2 ** Math.min(6, Math.max(0, Number(current.sync_attempts ?? 1) - 1)));
      if (!current.xero_invoice_id) {
        const historical = await query<{ xero_id: string }>(
          `SELECT xero_id FROM xero_sync_log WHERE BINARY business_id = BINARY ? AND sync_type = 'online_batch'
            AND status = 'success' AND BINARY detail = BINARY ? AND xero_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
          [input.businessId, `online batch ${input.channelInstanceId} ${input.date}`],
        );
        if (historical[0]?.xero_id) {
          current.xero_invoice_id = historical[0].xero_id;
          const adopted = await execute(
            `UPDATE xero_online_batches SET xero_invoice_id = COALESCE(xero_invoice_id, ?) WHERE ${leaseWhere}`,
            [current.xero_invoice_id, ...params(input), token],
          );
          if (adopted.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
        }
      }
      try {
        stages = json(current.sync_stages_json) ?? undefined;
        frozen = json(current.sync_input_json) ?? undefined;
      } catch {
        return await outcome('review', 'accounting_evidence_invalid');
      }
      if (!frozen && ['posting', 'error'].includes(current.invoice_status.toLowerCase())) {
        return await outcome('review', 'legacy_external_result_unverified');
      }
      // Main evidence is written before acknowledging tenant evidence. CAS preserves a newer generation.
      const propagate = async () => {
        const change = await dayChange(input);
        if (!change) return;
        const saved = await execute(
          `UPDATE xero_online_batches SET
            sync_review_reason = COALESCE(sync_review_reason, ?, IF(xero_invoice_id IS NOT NULL
              AND NOT(sync_source_generation <=> ?), 'posted_day_changed', NULL)),
            sync_source_generation = ? WHERE ${leaseWhere}`,
          [change.review_reason, change.generation, change.generation, ...params(input), token],
        );
        if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
        await imsExecute(
          `UPDATE ims_online_day_changes SET propagated_generation = ?
            WHERE BINARY business_id = BINARY ? AND BINARY channel_instance_id = BINARY ? AND business_date = ? AND generation = ?`,
          [change.generation, ...params(input), change.generation],
        );
        if ((await batchRow(input)).sync_review_reason) throw new OnlineAccountingReviewRequiredError('posted_day_changed');
      };
      await propagate();
      const fresh = await freezeInput(input);
      if (!fresh.prepared.policy.postingEnabled || fresh.prepared.policy.onlineBatchAction === 'none') return await outcome('blocked', 'posting_policy_disabled');
      if (current.xero_invoice_id && (!frozen || !current.sync_input_hash)) return await outcome('review', 'legacy_input_unverified');
      if (frozen && (!current.sync_input_hash || onlineDailyAccountingInputHash(frozen) !== current.sync_input_hash
        || onlineDailyAccountingInputHash(fresh) !== current.sync_input_hash)) return await outcome('review', 'accounting_input_changed');
      if (!frozen) {
        frozen = fresh;
        stages = initialStages(frozen);
        const saved = await execute(
          `UPDATE xero_online_batches SET sync_input_hash = ?, sync_input_json = ?, sync_stages_json = ?
            WHERE ${leaseWhere} AND sync_input_hash IS NULL AND sync_input_json IS NULL`,
          [onlineDailyAccountingInputHash(frozen), JSON.stringify(frozen), JSON.stringify(stages), ...params(input), token],
        );
        if (saved.affectedRows !== 1) throw new OnlineSyncLeaseLostError();
      }
      if (!stages) return await outcome('review', 'accounting_stage_evidence_missing');
      const required = initialStages(frozen);
      if (Object.keys(stages).sort().join('|') !== Object.keys(required).sort().join('|')
        || Object.values(stages).some(stage => !stage || !['pending', 'unconfirmed', 'completed', 'not_required'].includes(stage.state))) {
        return await outcome('review', 'accounting_stage_evidence_invalid');
      }
      if (!frozen.prepared.batch || !(frozen.prepared.totals.totalSales > 0)) return await outcome('blocked', 'no_sales');
      if (!frozen.revenueAccountCode || (stages.gift_card_liability.state !== 'not_required' && !frozen.liabilityAccountCode)) {
        return await outcome('blocked', 'account_mapping_missing');
      }
      await verifyStages(input, frozen, stages);
      if (Object.values(stages).some(stage => stage.state === 'unconfirmed')) return await outcome('review', 'external_result_unconfirmed');
      let mutations = 0;
      const guard: OnlineAccountingRecoveryGuard = {
        revenueAccountCode: frozen.revenueAccountCode,
        tracking: frozen.tracking,
        assertOwnership,
        beforeMutation: async stage => {
          await assertOwnership();
          if (++mutations > 25 || Date.now() - startedAt > 45_000) throw new OnlineAccountingSliceExhaustedError();
          await propagate();
          await assertOnlineDailyAccountingReady(input);
          const latest = await freezeInput(input);
          if (onlineDailyAccountingInputHash(latest) !== onlineDailyAccountingInputHash(frozen)) {
            throw new OnlineAccountingReviewRequiredError('accounting_input_changed');
          }
          stages![stage] = { state: 'unconfirmed' };
          await checkpoint('processing');
        },
      };
      const allDone = () => Object.values(stages!).every(stage => ['completed', 'not_required'].includes(stage.state));
      if (allDone()) {
        await propagate();
        await assertOnlineDailyAccountingReady(input);
        if (onlineDailyAccountingInputHash(await freezeInput(input)) !== onlineDailyAccountingInputHash(frozen)) return await outcome('review', 'accounting_input_changed');
        return await outcome('completed', 'completed');
      }
      await syncDailySalesBatch(input.businessId, frozen.prepared.batch, guard);
      await assertOwnership();
      await verifyStages(input, frozen, stages);
      await checkpoint('processing');
      if (stages.invoice.state !== 'completed' || stages.payments.state === 'pending' || stages.fees.state === 'pending') {
        return await outcome('retry', 'accounting_stages_incomplete');
      }
      if (stages.gift_card_liability.state === 'pending') {
        await syncGiftCardLiabilityReclass({
          businessId: input.businessId, amount: frozen.prepared.totals.giftCardAmount, date: input.date, channel: 'online',
          dedupeKey: `gift card liability online ${input.channelInstanceId} ${input.date}`,
          recovery: { ...guard, liabilityAccountCode: frozen.liabilityAccountCode! },
        });
      }
      await verifyStages(input, frozen, stages);
      await propagate();
      await assertOnlineDailyAccountingReady(input);
      if (onlineDailyAccountingInputHash(await freezeInput(input)) !== onlineDailyAccountingInputHash(frozen)) return await outcome('review', 'accounting_input_changed');
      if (Object.values(stages).some(stage => stage.state === 'unconfirmed')) return await outcome('review', 'external_result_unconfirmed');
      return await outcome(allDone() ? 'completed' : 'retry', allDone() ? 'completed' : 'accounting_stages_incomplete');
    } catch (error) {
      if (error instanceof OnlineSyncLeaseLostError) return { status: 'retry', reason: 'lease_lost' };
      const blockedReason = error instanceof OnlineDailySalesPreparationBlockedError ? error.reason
        : isXeroAccountingDisabledError(error) ? 'xero_accounting_disabled'
          : error instanceof OnlineDailyAccountingNotReadyError ? error.readiness.reason : null;
      if (blockedReason && token) {
        try { return await outcome('blocked', blockedReason); }
        catch { return { status: 'retry', reason: 'checkpoint_unconfirmed' }; }
      }
      if (error instanceof OnlineAccountingSliceExhaustedError && token) {
        try {
          if (frozen && stages) await verifyStages(input, frozen, stages);
          return await outcome('retry', 'invocation_budget');
        } catch { return { status: 'retry', reason: 'checkpoint_unconfirmed' }; }
      }
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'online_accounting_recovery', operation: 'daily_accounting',
        title: 'Online daily accounting did not complete',
        error: new Error(error instanceof OnlineAccountingReviewRequiredError ? 'Accounting evidence requires review.' : 'Accounting recovery failed.'),
        context: { channelInstanceId: input.channelInstanceId, date: input.date },
        reference: { type: 'online_daily_accounting', id: `${input.channelInstanceId}:${input.date}` },
      });
      if (!token) return { status: 'retry', reason: 'operational_failure' };
      try {
        if (frozen && stages) await verifyStages(input, frozen, stages);
        const rateLimitDelay = onlineAccountingRateLimitRetry(error);
        if (rateLimitDelay !== null) {
          retryAfterSeconds = Math.max(retryAfterSeconds, rateLimitDelay);
          for (const stage of Object.values(stages ?? {})) if (stage.state === 'unconfirmed') stage.state = 'pending';
          return await outcome('retry', 'provider_rate_limit');
        }
        if (error instanceof OnlineAccountingReviewRequiredError) return await outcome('review', 'accounting_input_or_invoice_review');
        if (Object.values(stages ?? {}).some(stage => stage.state === 'unconfirmed')) return await outcome('review', 'external_result_unconfirmed');
        return await outcome(error instanceof OnlineDailyAccountingNotReadyError ? 'blocked' : 'retry',
          error instanceof OnlineDailyAccountingNotReadyError ? error.readiness.reason : 'operational_failure');
      } catch {
        return { status: 'retry', reason: 'checkpoint_unconfirmed' };
      }
    } finally {
      if (token) await execute(
        `UPDATE xero_online_batches SET sync_lease_token = NULL, sync_lease_expires_at = NULL
          WHERE ${ownerWhere} AND sync_lease_token = ?`, [...params(input), token],
      ).catch(() => {});
    }
  });
}
