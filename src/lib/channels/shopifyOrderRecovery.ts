import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';
import { lockInventoryCostState } from '@/lib/ims/costing/fifoCostingService';
import { ShopifyOrderReviewRequiredError } from '@/lib/ims/shopifyOrderReview';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getShopifyOperationContext } from './shopifyOperationContext';
import { shopifyInstanceSettings } from './shopifyInstanceSettings';
import { assertOnlineRecoveryBusinessActive, getOnlineSyncControl } from './onlineSyncControl';
import { planShopifyOrderRecovery } from './shopifyOrderRecoveryPlan';
import {
  claimShopifyOrderSnapshot, completeShopifyOrderSnapshot, quarantineShopifyOrderSnapshot,
  releaseShopifyOrderLease, runShopifyOrderEffect,
} from './shopifyOrderCoordination';
import { applyCoordinatedShopifyRefund, applyCoordinatedShopifyFulfilment } from './shopifyOrderLocalEffects';
import { importShopifyOrderInTransaction, cancelShopifyOrderInTransaction } from './shopifyOrderImport';
import { updateShopifyOrderInTransaction } from './shopifyOrderUpdate';
import { enqueueOnlineSyncJob, type OnlineSyncSql } from './onlineSyncJobs';
import { OnlineSyncLeaseLostError, OnlineSyncValidationError, onlineSyncTimestamp } from './onlineSyncPolicy';
import { classifyOnlineSyncFailure } from './onlineSyncFailure';
import { markOnlineDayChanged, readShopifyAccountingFacts } from './shopifyRecoveryDayFacts';

export class OnlineSyncSliceYield extends Error {
  constructor() { super('Online recovery slice yielded with durable work remaining.'); }
}

function sqlFor(connection: PoolConnection): OnlineSyncSql {
  return {
    query: async (sql, params) => (await connection.execute<RowDataPacket[]>(sql, params))[0],
    execute: async (sql, params) => (await connection.execute<ResultSetHeader>(sql, params))[0],
  };
}

export async function applyShopifyRecoverySnapshot(input: {
  businessId: string; channelInstanceId: string; locationId: number;
  order: Record<string, unknown>; syncFrom: string; deadline: number;
}): Promise<'applied' | 'already_current' | 'review'> {
  const plan = planShopifyOrderRecovery(input);
  onlineSyncTimestamp(`${input.syncFrom}T00:00:00.000Z`);
  await assertOnlineRecoveryBusinessActive(input.businessId);
  const timeZone = await getBusinessTimeZone(input.businessId);
  const businessDate = new Date(String(input.order.created_at)).toLocaleDateString('sv-SE', { timeZone });
  if (businessDate < input.syncFrom) return 'already_current';
  const claim = await claimShopifyOrderSnapshot(plan.snapshot, plan.keys);
  if (claim.status === 'stale' || claim.status === 'duplicate') return 'already_current';
  if (claim.status === 'review') return 'review';
  if (claim.status === 'busy') throw new OnlineSyncSliceYield();
  if (claim.status !== 'ready') throw new OnlineSyncValidationError('Unexpected recovery claim state.');
  const lease = claim.lease;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone });
  const checkBudget = async () => {
    if (Date.now() >= input.deadline) throw new OnlineSyncSliceYield();
    await assertOnlineRecoveryBusinessActive(input.businessId);
  };
  try {
    const local = await imsQuery<{ id: number }>(
      `SELECT id FROM ims_sales_orders WHERE business_id = ? AND channel_instance_id = ?
        AND external_order_id = ?`, [input.businessId, input.channelInstanceId, lease.externalOrderId],
    );
    if (!local.length && businessDate < today && (plan.fulfilments.length || plan.refunds.length)) {
      await quarantineShopifyOrderSnapshot(lease, businessDate, 'historical_stock_evidence_missing');
      return 'review';
    }
    const fulfilmentHistory = input.order.fulfillments;
    if (Array.isArray(fulfilmentHistory) && fulfilmentHistory.some(row =>
      row && typeof row === 'object' && 'status' in row && row.status === 'cancelled')) {
      await quarantineShopifyOrderSnapshot(lease, businessDate, 'unsupported_fulfilment_history');
      return 'review';
    }
    await checkBudget();
    await runShopifyOrderEffect(lease, 'order_record', async connection => {
      await lockInventoryCostState(connection, input.businessId);
      const before = await readShopifyAccountingFacts(connection, lease);
      if (!before) {
        const imported = await importShopifyOrderInTransaction(connection, {
          businessId: input.businessId, channelInstanceId: input.channelInstanceId, locationId: input.locationId,
          topic: 'orders/create', order: input.order,
        });
        if (!imported.salesOrderId) throw new OnlineSyncValidationError('Recovery order has no local sales order.');
      }
      const updated = await updateShopifyOrderInTransaction(connection, {
        businessId: input.businessId, channelInstanceId: input.channelInstanceId, order: input.order,
      });
      const after = await readShopifyAccountingFacts(connection, lease);
      if (!after) throw new Error('Recovery order accounting evidence is missing.');
      if (!before || before.hash !== after.hash) {
        await markOnlineDayChanged(connection, lease, after.businessDate);
        if (before && before.businessDate !== after.businessDate) {
          await markOnlineDayChanged(connection, lease, before.businessDate);
        }
      }
      return { status: 'applied', referenceId: String(updated.salesOrderId) };
    });
    for (const fulfilment of plan.fulfilments) {
      await checkBudget();
      await applyCoordinatedShopifyFulfilment(lease, {
        topic: 'fulfillments/create', payload: { ...fulfilment, order_id: lease.externalOrderId },
      });
    }
    if (input.order.fulfillment_status === 'fulfilled') {
      await checkBudget();
      await applyCoordinatedShopifyFulfilment(lease, { topic: 'orders/fulfilled', payload: input.order });
    }
    for (const refund of plan.refunds) {
      await checkBudget();
      await applyCoordinatedShopifyRefund(lease, { ...refund, order_id: lease.externalOrderId });
    }
    if (plan.cancelled) {
      await checkBudget();
      await runShopifyOrderEffect(lease, 'cancellation', async connection => {
        await lockInventoryCostState(connection, input.businessId);
        const before = await readShopifyAccountingFacts(connection, lease);
        const result = await cancelShopifyOrderInTransaction(connection, {
          businessId: input.businessId, channelInstanceId: input.channelInstanceId, order: input.order,
        });
        const after = await readShopifyAccountingFacts(connection, lease);
        if (after && before?.hash !== after.hash) await markOnlineDayChanged(connection, lease, after.businessDate);
        return { status: 'applied', referenceId: String(result.salesOrderId) };
      });
    }
    await checkBudget();
    await runShopifyOrderEffect(lease, 'downstream', async connection => {
      if (!plan.paid && !plan.refunds.length) return { status: 'not_required' };
      const operationKey = `effects:${lease.externalOrderId}:${lease.hash}`;
      await enqueueOnlineSyncJob({
        businessId: lease.businessId, channelInstanceId: lease.channelInstanceId,
        provider: 'shopify', operation: 'shopify_order_apply', operationKey,
        payload: {
          kind: 'order_effects', orderId: lease.externalOrderId, updatedAt: lease.updatedAt,
          hash: lease.hash, paid: plan.paid, refundIds: plan.refunds.map(row => String(row.id)),
        },
      }, sqlFor(connection));
      return { status: 'queued', operation: 'shopify_order_apply', operationKey };
    });
    await completeShopifyOrderSnapshot(lease);
    return 'applied';
  } catch (error) {
    if (error instanceof ShopifyOrderReviewRequiredError) {
      await quarantineShopifyOrderSnapshot(lease, businessDate, error.reason);
      return 'review';
    }
    throw error;
  } finally { await releaseShopifyOrderLease(lease); }
}

export async function queueShopifyRecoveryEvent(input: {
  businessId: string; channelInstanceId: string; topic: string;
  payload: Record<string, unknown>; eventId?: string;
}) {
  const id = input.topic.startsWith('fulfillments/') || input.topic === 'refunds/create'
    ? input.payload.order_id : input.payload.id;
  const orderId = String(id ?? '');
  if (!/^[1-9]\d{0,99}$/.test(orderId)) throw new OnlineSyncValidationError('Invalid recovery event order identity.');
  const key = createHash('sha256').update(input.eventId ?? randomUUID()).digest('hex').slice(0, 32);
  const operationKey = `event:${orderId}:${key}`;
  // Pausing execution must still permit a durable handoff of authenticated deliveries.
  await imsExecute(
    `INSERT IGNORE INTO ims_sales_channel_jobs
      (business_id,channel_instance_id,provider,operation,operation_key,payload_json,available_at)
     SELECT ?,?,'shopify','shopify_order_apply',?,?,UTC_TIMESTAMP(3)
       FROM ims_online_sync_control WHERE business_id = ? AND rollout_state IN ('validation','cutover')`,
    [input.businessId, input.channelInstanceId, operationKey,
      JSON.stringify({ kind: 'order_snapshot', orderId }), input.businessId],
  );
  const jobs = await imsQuery<{ id: number }>(
    `SELECT id FROM ims_sales_channel_jobs WHERE business_id = ? AND channel_instance_id = ?
      AND provider = 'shopify' AND operation = 'shopify_order_apply' AND operation_key = ?`,
    [input.businessId, input.channelInstanceId, operationKey],
  );
  if (!jobs.length) throw new Error('Shopify recovery event was not durably queued.');
  const control = await getOnlineSyncControl(input.businessId);
  if (control.paused) return { eventStatus: 'complete' as const, outcome: 'queued', salesOrderId: null };
  try {
    await assertOnlineRecoveryBusinessActive(input.businessId);
    const context = await getShopifyOperationContext(input);
    const settings = shopifyInstanceSettings(context.instance.settings);
    if (!settings.orders.enabled || !settings.orders.locationId || !settings.orders.syncFrom) {
      throw new OnlineSyncValidationError('Shopify recovery order settings are incomplete.');
    }
    const order = await new ShopifyService(context.credentials.shopDomain, context.credentials.token)
      .getOrderForReconciliation(orderId);
    const result = await applyShopifyRecoverySnapshot({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId,
      locationId: settings.orders.locationId, syncFrom: settings.orders.syncFrom,
      order: { ...order }, deadline: Date.now() + 20_000,
    });
    return { eventStatus: 'complete' as const, outcome: result, salesOrderId: null };
  } catch (error) {
    if (!(error instanceof OnlineSyncSliceYield) && !(error instanceof OnlineSyncLeaseLostError)) {
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'shopify_webhook', operation: 'recovery_event_handoff',
        title: 'Shopify order is queued for durable recovery',
        error: new Error(`Recovery event handoff: ${classifyOnlineSyncFailure(error).code}`),
        context: { channelInstanceId: input.channelInstanceId, externalOrderId: orderId },
        reference: { type: 'shopify_order', id: orderId },
      });
    }
    return { eventStatus: 'complete' as const, outcome: 'queued', salesOrderId: null };
  }
}
