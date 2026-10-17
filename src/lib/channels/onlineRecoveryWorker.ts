import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from '@/services/MySQLService';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getOnlineChannelCapabilities, isXeroAccountingEnabled } from '@/lib/ims/businessOperations';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ShopifyService } from '@/services/ShopifyService';
import { SalesChannelInstanceRepository } from './channelInstanceRepository';
import { assertOnlineRecoveryBusinessActive, getOnlineSyncControl } from './onlineSyncControl';
import { classifyOnlineSyncFailure } from './onlineSyncFailure';
import { checkCronJobEnabled } from '@/lib/cron/settings';
import { getShopifyOperationContext } from './shopifyOperationContext';
import { shopifyInstanceSettings } from './shopifyInstanceSettings';
import {
  assertOnlineSyncLease, claimOnlineSyncBusiness, claimOnlineSyncJob, enqueueOnlineSyncJob,
  failOnlineSyncJob, finishOnlineSyncJob, releaseOnlineSyncBusiness, renewOnlineSyncJob,
  checkpointOnlineSyncJob, saveOnlineSyncWorkPayload, yieldOnlineSyncJob,
  type OnlineSyncJobLease, type OnlineSyncOperation, type OnlineSyncSql, type OnlineSyncFailureCode,
} from './onlineSyncJobs';
import {
  ONLINE_SYNC_LIMITS, OnlineSyncLeaseLostError, OnlineSyncValidationError, nextOnlineSyncDue,
  nextReconciliationWindow, parseReconciliationContinuation, onlineSyncTimestamp,
  type ReconciliationContinuation, type ReconciliationWindow,
} from './onlineSyncPolicy';
import { applyShopifyRecoverySnapshot, OnlineSyncSliceYield } from './shopifyOrderRecovery';
import { runShopifyReconciliationSlice } from './shopifyReconciliationSlice';
import { shopifyOrderSnapshot } from './shopifyOrderSnapshot';
import { recoverShopifyPaidOrderEffects, recoverShopifyRefundDownstreamEffects } from './shopifyOrderRecoveryEffects';
import { recoverShopifyGiftCardEffects } from './shopifyGiftCardRecoveryEffects';
import { runOnlineDailyAccountingRecovery } from '@/lib/xero/onlineDailyAccountingRecovery';

class OnlineSyncWorkPending extends Error {
  constructor(readonly code: OnlineSyncFailureCode, readonly retryAfterSeconds = 0, readonly notify = false) {
    super(`Online recovery is waiting: ${code}`);
  }
}

function sqlFor(connection: PoolConnection): OnlineSyncSql {
  return {
    query: async (sql, params) => (await connection.execute<RowDataPacket[]>(sql, params))[0],
    execute: async (sql, params) => (await connection.execute<ResultSetHeader>(sql, params))[0],
  };
}

async function transaction(work: (connection: PoolConnection, sql: OnlineSyncSql) => Promise<void>) {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    await work(connection, sqlFor(connection));
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

interface ReconciliationState {
  baseline_from: string;
  baseline_complete: number;
  covered_through: string | null;
  continuation_json: unknown;
}

async function renewRecoveryLease(lease: OnlineSyncJobLease) {
  await assertOnlineRecoveryBusinessActive(lease.business.businessId);
  await renewOnlineSyncJob(lease);
}

function freshContinuation(window: ReconciliationWindow): ReconciliationContinuation {
  return { window, pageInfo: null, nextPageInfo: null, pageLoaded: false, remaining: [] };
}

async function runReconciliation(lease: OnlineSyncJobLease, deadline: number, budget: number, applying: () => void) {
  const businessId = lease.business.businessId;
  const context = await getShopifyOperationContext({ businessId, channelInstanceId: lease.channelInstanceId });
  const settings = shopifyInstanceSettings(context.instance.settings);
  if (!settings.orders.enabled || !settings.orders.locationId || !settings.orders.syncFrom) {
    throw new OnlineSyncValidationError('Shopify recovery settings are incomplete or disabled.');
  }
  const service = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
  const [state] = await imsQuery<ReconciliationState>(
    `SELECT DATE_FORMAT(baseline_from,'%Y-%m-%dT%H:%i:%sZ') AS baseline_from,baseline_complete,
       DATE_FORMAT(covered_through,'%Y-%m-%dT%H:%i:%sZ') AS covered_through,continuation_json
      FROM ims_shopify_reconciliation WHERE business_id = ? AND channel_instance_id = ?`,
    [businessId, lease.channelInstanceId],
  );
  if (!state) throw new Error('Shopify recovery baseline has not been initialized.');
  const antiEntropy = lease.operationKey.startsWith('anti_entropy:');
  let continuation = lease.continuation;
  if (!continuation && !antiEntropy && state.continuation_json != null) {
    continuation = parseReconciliationContinuation(typeof state.continuation_json === 'string'
      ? JSON.parse(state.continuation_json) : state.continuation_json);
  }
  if (!continuation) {
    const window = antiEntropy ? {
      phase: 'anti_entropy' as const,
      from: new Date(Math.max(Date.parse(state.baseline_from), Date.now() - 7 * 86400_000)).toISOString(),
      to: new Date(Date.now() - ONLINE_SYNC_LIMITS.visibilityLagMs).toISOString(),
    } : nextReconciliationWindow({
      baselineFrom: state.baseline_from, coveredThrough: state.covered_through, now: new Date().toISOString(),
    });
    if (!window) {
      await finishOnlineSyncJob(lease, nextOnlineSyncDue(new Date().toISOString(), businessId, lease.channelInstanceId));
      return 0;
    }
    continuation = freshContinuation(window);
  }
  const save = async (next: ReconciliationContinuation) => transaction(async (connection, sql) => {
    await checkpointOnlineSyncJob(lease, next, sql);
    if (!antiEntropy) {
      await connection.execute(
        `UPDATE ims_shopify_reconciliation SET continuation_json = ?
          WHERE business_id = ? AND channel_instance_id = ?`,
        [JSON.stringify(next), businessId, lease.channelInstanceId],
      );
    }
  });
  if (!lease.continuation) await save(continuation);
  if (continuation.window.phase === 'baseline') {
    await service.verifyOrderReconciliationHistoryAccess(state.baseline_from, new Date().toISOString());
  }
  const result = await runShopifyReconciliationSlice({ continuation, deadline, remainingBudget: budget }, {
    now: Date.now,
    renew: () => renewRecoveryLease(lease),
    save,
    page: (window, pageInfo) => service.getOrderReconciliationPage(window, pageInfo),
    apply: async reference => {
      applying();
      const order = await service.getOrderForReconciliation(reference.id);
      if (Date.parse(String(order.updated_at)) < Date.parse(reference.updatedAt)) {
        throw new Error('Shopify detail has not reached the discovered source version.');
      }
      return applyShopifyRecoverySnapshot({
        businessId, channelInstanceId: lease.channelInstanceId,
        locationId: settings.orders.locationId!, syncFrom: settings.orders.syncFrom!,
        order: { ...order }, deadline,
      });
    },
    complete: window => transaction(async (connection, sql) => {
      await assertOnlineSyncLease(lease, sql);
      if (window.phase === 'baseline') {
        const next = freshContinuation({
          phase: 'catchup',
          from: new Date(Math.max(Date.parse(state.baseline_from), Date.parse(window.to) - ONLINE_SYNC_LIMITS.overlapMs)).toISOString(),
          to: new Date(Math.max(Date.now() - ONLINE_SYNC_LIMITS.visibilityLagMs, Date.parse(window.to) + 1)).toISOString(),
        });
        await checkpointOnlineSyncJob(lease, next, sql);
        await connection.execute(
          `UPDATE ims_shopify_reconciliation SET continuation_json = ?
            WHERE business_id = ? AND channel_instance_id = ?`,
          [JSON.stringify(next), businessId, lease.channelInstanceId],
        );
        await yieldOnlineSyncJob(lease, sql);
      } else {
        // The fenced job update locks the control and job rows before coverage changes.
        await finishOnlineSyncJob(lease, antiEntropy ? null
          : nextOnlineSyncDue(new Date().toISOString(), businessId, lease.channelInstanceId), sql);
        if (!antiEntropy) {
          await connection.execute(
            `UPDATE ims_shopify_reconciliation SET baseline_complete = 1,
               covered_through = GREATEST(COALESCE(covered_through,?),?), continuation_json = NULL,
               last_success_at = UTC_TIMESTAMP(3),safe_error_code = NULL,next_check_at = ?
              WHERE business_id = ? AND channel_instance_id = ?`,
            [new Date(window.to), new Date(window.to),
              new Date(nextOnlineSyncDue(new Date().toISOString(), businessId, lease.channelInstanceId)),
              businessId, lease.channelInstanceId],
          );
        }
      }
    }),
  });
  if (!result.complete) await yieldOnlineSyncJob(lease);
  return result.processed;
}

async function runApplication(lease: OnlineSyncJobLease, deadline: number) {
  if (Date.now() >= deadline) throw new OnlineSyncSliceYield();
  await renewRecoveryLease(lease);
  const businessId = lease.business.businessId;
  const payload = lease.payload;
  if (!payload) throw new OnlineSyncValidationError('Recovery job has no validated payload.');
  if (payload.kind === 'daily_accounting') {
    const result = await runOnlineDailyAccountingRecovery({
      businessId, channelInstanceId: lease.channelInstanceId, date: payload.date, manual: payload.manual,
    });
    if (result.status !== 'completed') {
      if (result.status === 'review') {
        await saveOnlineSyncWorkPayload(lease, { ...payload, blockedReason: 'accounting_review_required' });
      }
      throw new OnlineSyncWorkPending(
        result.status === 'review' ? 'accounting_review_required'
          : result.reason === 'rebaseline_required' ? 'rebaseline_required'
          : result.status === 'blocked' ? 'awaiting_reconciliation' : 'operational_failure',
        result.retryAfterSeconds ?? 0, result.status === 'retry' || result.status === 'review',
      );
    }
  } else if (payload.kind === 'gift_cards') {
    const result = await recoverShopifyGiftCardEffects({
      businessId, channelInstanceId: lease.channelInstanceId,
      ...(payload.continuation ? { continuation: payload.continuation } : {}),
      beforeCommit: async connection => {
        await assertOnlineRecoveryBusinessActive(businessId);
        await assertOnlineSyncLease(lease, sqlFor(connection));
      },
    });
    await saveOnlineSyncWorkPayload(lease, {
      kind: 'gift_cards', continuation: result.continuation,
      ...(result.status === 'blocked' ? { blockedReason: 'gift_card_review_required' } : {}),
    });
    if (result.status === 'pending') { await yieldOnlineSyncJob(lease); return; }
    if (result.status !== 'completed') {
      throw new OnlineSyncWorkPending(result.status === 'blocked' ? 'gift_card_review_required' : 'operational_failure', 0, true);
    }
    await renewRecoveryLease(lease);
    await finishOnlineSyncJob(lease, nextOnlineSyncDue(new Date().toISOString(), businessId, lease.channelInstanceId));
    return;
  } else {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId: lease.channelInstanceId });
    const settings = shopifyInstanceSettings(context.instance.settings);
    if (!settings.orders.enabled || !settings.orders.locationId || !settings.orders.syncFrom) {
      throw new OnlineSyncValidationError('Shopify recovery order settings are incomplete or disabled.');
    }
    const order = { ...await new ShopifyService(context.credentials.shopDomain, context.credentials.token)
      .getOrderForReconciliation(payload.orderId) };
    if (payload.kind === 'order_snapshot') {
      const applied = await applyShopifyRecoverySnapshot({
        businessId, channelInstanceId: lease.channelInstanceId, locationId: settings.orders.locationId,
        syncFrom: settings.orders.syncFrom, order, deadline,
      });
      if (applied === 'review') {
        await saveOnlineSyncWorkPayload(lease, { ...payload, blockedReason: 'order_review_required' });
        throw new OnlineSyncWorkPending('order_review_required', 0, true);
      }
    } else {
      const snapshot = shopifyOrderSnapshot({ businessId, channelInstanceId: lease.channelInstanceId, order });
      if (Date.parse(snapshot.updatedAt) < Date.parse(payload.updatedAt)) {
        throw new Error('Downstream provider source has not reached the planned version.');
      }
      if (snapshot.hash !== payload.hash) {
        if (!Array.isArray(order.refunds)
          || payload.refundIds.some(id => !order.refunds.some(row => String(row.id) === id))
          || (payload.paid && !['paid','partially_refunded','refunded'].includes(String(order.financial_status)))) {
          throw new OnlineSyncValidationError('Downstream recovery source lost required evidence.');
        }
        const applied = await applyShopifyRecoverySnapshot({
          businessId, channelInstanceId: lease.channelInstanceId, locationId: settings.orders.locationId,
          syncFrom: settings.orders.syncFrom, order, deadline,
        });
        if (applied === 'review') throw new OnlineSyncValidationError('Changed recovery source requires review.');
        const [handoff] = await imsQuery<{ id: number }>(
          `SELECT id FROM ims_sales_channel_jobs WHERE business_id = ? AND channel_instance_id = ?
            AND provider = 'shopify' AND operation = 'shopify_order_apply' AND operation_key = ?`,
          [businessId, lease.channelInstanceId, `effects:${payload.orderId}:${snapshot.hash}`],
        );
        if (!handoff) throw new Error('Updated recovery effects have not been durably handed off.');
        await renewRecoveryLease(lease);
        await finishOnlineSyncJob(lease, null);
        return;
      }
      if (payload.paid) {
        await renewRecoveryLease(lease);
        const paid = await recoverShopifyPaidOrderEffects({ businessId, channelInstanceId: lease.channelInstanceId, order });
        if (paid.status !== 'completed') throw new Error('Paid-order loyalty recovery is unfinished.');
      }
      for (const refundId of payload.refundIds) {
        if (Date.now() >= deadline) throw new OnlineSyncSliceYield();
        await renewRecoveryLease(lease);
        if (!Array.isArray(order.refunds)) throw new OnlineSyncValidationError('Incomplete recovery refund source.');
        const refund = order.refunds.find(row => String(row.id) === refundId);
        if (!refund) throw new OnlineSyncValidationError('Planned recovery refund is missing.');
        const [note] = await imsQuery<{ id: number }>(
          `SELECT cn.id FROM ims_credit_notes cn JOIN ims_sales_orders so ON so.id = cn.so_id
            WHERE cn.business_id = ? AND cn.channel_instance_id = ? AND cn.external_refund_id = ?
              AND cn.status = 'complete' AND so.business_id = ? AND so.channel_instance_id = ?
              AND so.external_order_id = ?`,
          [businessId, lease.channelInstanceId, refundId, businessId, lease.channelInstanceId, payload.orderId],
        );
        if (!note) throw new Error('Downstream refund has no exact completed credit note.');
        const result = await recoverShopifyRefundDownstreamEffects({
          businessId, channelInstanceId: lease.channelInstanceId,
          refund: { ...refund, order_id: payload.orderId }, creditNoteId: note.id,
        });
        if (result.status !== 'completed') throw new Error('Refund accounting or loyalty recovery is unfinished.');
      }
      if (settings.giftCards.mode === 'combined') {
        await enqueueOnlineSyncJob({
          businessId, channelInstanceId: lease.channelInstanceId, provider: 'shopify', operation: 'shopify_order_apply',
          operationKey: 'gift_cards',
          payload: { kind: 'gift_cards', continuation: null },
        });
      }
    }
  }
  await renewRecoveryLease(lease);
  await finishOnlineSyncJob(lease, null);
}

async function prepareBusiness(
  businessId: string, today: string, channelInstanceId?: string, deadline = Date.now() + ONLINE_SYNC_LIMITS.invocationMs,
) {
  const capabilities = await getOnlineChannelCapabilities(businessId);
  const instances = (await SalesChannelInstanceRepository.listForBusiness(businessId))
    .filter(channel => (!channelInstanceId || channel.channelInstanceId === channelInstanceId)
      && channel.enabled && channel.runtimeStatus === 'active' && channel.readinessStatus === 'ready'
      && ((channel.provider === 'shopify' && capabilities.shopifyEnabled)
        || (channel.provider === 'native_shop' && capabilities.nativeShopEnabled)));
  for (const channel of instances) {
    if (Date.now() >= deadline) break;
    if (channel.provider !== 'shopify') continue;
    const settings = shopifyInstanceSettings(channel.settings);
    if (settings.giftCards.mode === 'combined') {
      await enqueueOnlineSyncJob({
        businessId, channelInstanceId: channel.channelInstanceId, provider: 'shopify',
        operation: 'shopify_order_apply', operationKey: 'gift_cards',
        payload: { kind: 'gift_cards', continuation: null },
      });
    }
    if (!settings.orders.enabled || !settings.orders.syncFrom || !settings.orders.locationId) continue;
    const start = onlineSyncTimestamp(`${settings.orders.syncFrom}T00:00:00.000Z`);
    await imsExecute(
      `INSERT IGNORE INTO ims_shopify_reconciliation (business_id,channel_instance_id,baseline_from)
       VALUES (?,?,?)`, [businessId, channel.channelInstanceId, new Date(start - 86400_000)],
    );
    await enqueueOnlineSyncJob({
      businessId, channelInstanceId: channel.channelInstanceId, provider: 'shopify',
      operation: 'shopify_order_reconcile', operationKey: 'reconcile',
    });
    const [state] = await imsQuery<{ baseline_complete: number }>(
      'SELECT baseline_complete FROM ims_shopify_reconciliation WHERE business_id = ? AND channel_instance_id = ?',
      [businessId, channel.channelInstanceId],
    );
    if (Number(state?.baseline_complete) === 1) {
      await enqueueOnlineSyncJob({
        businessId, channelInstanceId: channel.channelInstanceId, provider: 'shopify',
        operation: 'shopify_order_reconcile', operationKey: `anti_entropy:${today}`,
      });
    }
  }
  const accountingIds = await isXeroAccountingEnabled(businessId)
    ? instances.filter(channel => channel.provider === 'native_shop'
      || shopifyInstanceSettings(channel.settings).xero.dailyAutoSyncEnabled).map(channel => channel.channelInstanceId)
    : [];
  if (accountingIds.length && Date.now() < deadline) {
    const dates = await imsQuery<{ channel_instance_id: string; business_date: string; provider: 'shopify' | 'native_shop' }>(
      `SELECT days.channel_instance_id,days.business_date,days.provider FROM
        (SELECT DISTINCT channel_instance_id,DATE_FORMAT(order_date,'%Y-%m-%d') AS business_date,sales_channel AS provider
          FROM ims_sales_orders WHERE business_id = ? AND so_type = 'online' AND is_staff_preview_test = 0
            AND COALESCE(is_historical,0) = 0 AND order_date < ?
            AND channel_instance_id IN (${accountingIds.map(() => '?').join(',')})) days
        LEFT JOIN ims_sales_channel_jobs job ON job.business_id = ? AND job.channel_instance_id = days.channel_instance_id
          AND job.operation = 'online_daily_accounting' AND job.operation_key = days.business_date
        WHERE job.id IS NULL ORDER BY days.business_date LIMIT 25`,
      [businessId, today, ...accountingIds, businessId],
    );
    for (const day of dates) {
      if (Date.now() >= deadline) break;
      if (instances.find(channel => channel.channelInstanceId === day.channel_instance_id)?.provider !== day.provider) {
        throw new OnlineSyncValidationError('Accounting day provider does not match its exact storefront.');
      }
      await enqueueOnlineSyncJob({
        businessId, channelInstanceId: day.channel_instance_id, provider: day.provider,
        operation: 'online_daily_accounting', operationKey: day.business_date,
        payload: { kind: 'daily_accounting', date: day.business_date },
      });
    }
    await imsExecute(
      `UPDATE ims_sales_channel_jobs job JOIN ims_online_day_changes changes
        ON changes.business_id = job.business_id AND changes.channel_instance_id = job.channel_instance_id
          AND changes.business_date = job.operation_key
        SET job.status = 'pending',job.available_at = UTC_TIMESTAMP(3)
        WHERE job.business_id = ? AND job.operation = 'online_daily_accounting' AND job.status = 'complete'
          AND NOT (changes.generation <=> changes.propagated_generation)`, [businessId],
    );
  }
  return instances.map(channel => channel.channelInstanceId);
}

export async function requestOnlineRecovery(businessId: string, channelInstanceId?: string): Promise<void> {
  await assertOnlineRecoveryBusinessActive(businessId);
  const control = await getOnlineSyncControl(businessId);
  if (control.mode === 'legacy' || control.paused) {
    throw new OnlineSyncValidationError('Recovery is not active or is paused.');
  }
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: await getBusinessTimeZone(businessId) });
  await prepareBusiness(businessId, today, channelInstanceId);
  await imsExecute(
    `UPDATE ims_sales_channel_jobs job JOIN ims_online_sync_control control ON control.business_id = job.business_id
      SET job.status = 'pending',job.available_at = UTC_TIMESTAMP(3)
      WHERE job.business_id = ? AND control.paused = 0 AND control.rollout_state IN ('validation','cutover')
        AND job.operation = 'shopify_order_reconcile' AND job.operation_key = 'reconcile'
        AND (job.status IN ('pending','failed') OR (job.status = 'processing' AND job.lease_expires_at <= UTC_TIMESTAMP(3)))
        ${channelInstanceId ? 'AND job.channel_instance_id = ?' : ''}`,
    channelInstanceId ? [businessId, channelInstanceId] : [businessId],
  );
}

export async function runOnlineRecoveryDispatch() {
  const deadline = Date.now() + ONLINE_SYNC_LIMITS.invocationMs;
  const result = { processed: 0, jobs: 0, failed: 0, businesses: 0 };
  const accountingPaused = await checkCronJobEnabled('online-sales');
  const [count] = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM businesses WHERE deleted_at IS NULL AND COALESCE(automation_paused,0) = 0
      AND ims_db_name IS NOT NULL AND TRIM(ims_db_name) <> ''`, [],
  );
  const groups = Math.max(1, Math.ceil(Number(count?.total ?? 0) / 100));
  const offset = (Math.floor(Date.now() / (5 * 60_000)) % groups) * 100;
  const businesses = await query<{ business_id: string }>(
    `SELECT business_id FROM businesses WHERE deleted_at IS NULL AND COALESCE(automation_paused,0) = 0
      AND ims_db_name IS NOT NULL AND TRIM(ims_db_name) <> ''
      ORDER BY business_id LIMIT 100 OFFSET ${offset}`, [],
  );
  const eligible: { businessId: string; lastRunAt: string }[] = [];
  for (const row of businesses) {
    if (Date.now() >= deadline) break;
    try {
      const control = await runImsForBusiness(row.business_id, () => getOnlineSyncControl(row.business_id));
      if (control.mode !== 'legacy' && !control.paused) {
        eligible.push({ businessId: row.business_id, lastRunAt: control.lastRunAt ?? '' });
      }
    } catch {
      result.failed += 1;
      await reportRuntimeIssue({
        businessId: row.business_id, source: 'cron', operation: 'online_recovery_eligibility',
        title: 'Online recovery eligibility could not be verified', error: new Error('Recovery control query failed.'),
      });
    }
  }
  eligible.sort((left, right) => left.lastRunAt.localeCompare(right.lastRunAt));
  for (const { businessId } of eligible) {
    if (Date.now() >= deadline || result.processed >= ONLINE_SYNC_LIMITS.ordersPerInvocation) break;
    await runImsForBusiness(businessId, async () => {
      const business = await claimOnlineSyncBusiness(businessId);
      if (!business) return;
      let lease: OnlineSyncJobLease | null = null;
      try {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: await getBusinessTimeZone(businessId) });
        const ids = await prepareBusiness(businessId, today, undefined, deadline);
        if (!ids.length || Date.now() >= deadline) return;
        const perChannel = new Map<string, number>();
        const reconciled = new Set<string>();
        let businessJobs = 0;
        while (businessJobs < ONLINE_SYNC_LIMITS.jobsPerBusiness && Date.now() < deadline
          && result.processed < ONLINE_SYNC_LIMITS.ordersPerInvocation) {
          lease = null;
          const exhausted = [...perChannel].filter(([, count]) => count >= ONLINE_SYNC_LIMITS.ordersPerChannel).map(([id]) => id);
          const [job] = await imsQuery<{
            channel_instance_id: string; provider: 'shopify' | 'native_shop';
            operation: OnlineSyncOperation; operation_key: string;
          }>(
            `SELECT channel_instance_id,provider,operation,operation_key FROM ims_sales_channel_jobs job
              WHERE business_id = ? AND channel_instance_id IN (${ids.map(() => '?').join(',')})
                AND operation IN ('shopify_order_reconcile','shopify_order_apply','online_daily_accounting')
                ${accountingPaused
                  ? "AND (operation <> 'online_daily_accounting' OR JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.manual')) = 'true')"
                  : ''}
                AND (operation <> 'online_daily_accounting' OR provider <> 'shopify'
                  OR EXISTS (SELECT 1 FROM ims_shopify_reconciliation coverage
                    WHERE coverage.business_id = job.business_id AND coverage.channel_instance_id = job.channel_instance_id
                      AND coverage.baseline_complete = 1))
                ${exhausted.length ? `AND channel_instance_id NOT IN (${exhausted.map(() => '?').join(',')})` : ''}
                ${reconciled.size ? `AND NOT (operation = 'shopify_order_reconcile'
                  AND channel_instance_id IN (${[...reconciled].map(() => '?').join(',')}))` : ''}
                AND JSON_EXTRACT(payload_json,'$.blockedReason') IS NULL
                AND ((status IN ('pending','failed') AND available_at <= UTC_TIMESTAMP(3))
                  OR (status = 'processing' AND lease_expires_at <= UTC_TIMESTAMP(3)))
              ORDER BY available_at,id LIMIT 1`, [businessId, ...ids, ...exhausted, ...reconciled],
          );
          if (!job) break;
          lease = await claimOnlineSyncJob({
            business, channelInstanceId: job.channel_instance_id, provider: job.provider,
            operation: job.operation, operationKey: job.operation_key,
          });
          if (!lease) break;
          if (businessJobs === 0) result.businesses += 1;
          businessJobs += 1;
          result.jobs += 1;
          const channelId = lease.channelInstanceId;
          const countApplication = () => {
            result.processed += 1;
            perChannel.set(channelId, (perChannel.get(channelId) ?? 0) + 1);
          };
          if (lease.operation === 'shopify_order_reconcile') {
            reconciled.add(channelId);
            await runReconciliation(lease, deadline, Math.min(
              ONLINE_SYNC_LIMITS.ordersPerInvocation - result.processed,
              ONLINE_SYNC_LIMITS.ordersPerChannel - (perChannel.get(channelId) ?? 0),
            ), countApplication);
          } else {
            countApplication();
            await runApplication(lease, deadline);
          }
        }
      } catch (error) {
        if (error instanceof OnlineSyncSliceYield) {
          if (lease) await yieldOnlineSyncJob(lease);
        } else if (error instanceof OnlineSyncWorkPending) {
          if (lease) {
            try { await failOnlineSyncJob(lease, error.code, Math.random(), error.retryAfterSeconds); } catch (saveError) {
              if (saveError instanceof OnlineSyncLeaseLostError) return;
              throw saveError;
            }
          }
          if (error.notify) {
            result.failed += 1;
            await reportRuntimeIssue({
              businessId, source: 'cron', operation: 'online_recovery_required_work',
              title: 'Online recovery has unfinished required work',
              error: new Error(`Required recovery work: ${error.code}`),
              severity: lease && lease.attempts >= 8 ? 'critical' : 'error',
              context: lease ? { channelInstanceId: lease.channelInstanceId, operationKey: lease.operationKey } : {},
            });
          }
        } else if (!(error instanceof OnlineSyncLeaseLostError)) {
          result.failed += 1;
          const failure = classifyOnlineSyncFailure(error);
          if (lease) {
            try { await failOnlineSyncJob(lease, failure.code, Math.random(), failure.retryAfterSeconds); } catch (saveError) {
              if (!(saveError instanceof OnlineSyncLeaseLostError)) {
                await reportRuntimeIssue({
                  businessId, source: 'cron', operation: 'online_recovery_retry_persistence',
                  title: 'Online recovery retry could not be persisted', error: new Error('Recovery retry persistence failed.'),
                });
              }
            }
          }
          await reportRuntimeIssue({
            businessId, source: 'cron', operation: 'online_recovery_slice',
            title: 'Online recovery work is waiting for retry',
            error: new Error(`Online recovery failed: ${failure.code}`),
            context: lease ? {
              channelInstanceId: lease.channelInstanceId, operation: lease.operation,
              operationKey: lease.operationKey, attempts: lease.attempts,
            } : {},
            reference: lease ? { type: 'online_recovery_job', id: lease.operationKey } : undefined,
          });
        }
      } finally { await releaseOnlineSyncBusiness(business); }
    });
  }
  return result;
}
