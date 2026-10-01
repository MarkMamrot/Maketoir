import { NextResponse } from 'next/server';

import { reconcileShopifyFulfilmentsForChannel } from '@/lib/channels/shopifyFulfilmentReconciliation';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 1800;

type ActiveShopifyChannel = { business_id: string; channel_instance_id: string };

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startedAt = Date.now();
  const windowEnd = new Date(startedAt).toISOString();
  const windowStart = new Date(startedAt - (36 * 60 * 60 * 1000)).toISOString();
  let channels: ActiveShopifyChannel[];
  try {
    channels = await query<ActiveShopifyChannel>(
      `SELECT instance.business_id, instance.channel_instance_id
         FROM sales_channel_instances instance
         JOIN businesses business ON BINARY business.business_id = BINARY instance.business_id
        WHERE instance.provider = 'shopify'
          AND instance.is_enabled = 1
          AND instance.runtime_status = 'active'
          AND instance.readiness_status = 'ready'
          AND business.deleted_at IS NULL
          AND COALESCE(business.automation_paused, 0) = 0
        ORDER BY instance.business_id, instance.channel_instance_id`,
    );
  } catch (error) {
    await reportRuntimeIssue({
      source: 'cron',
      operation: 'shopify_fulfilment_reconciliation_load_channels',
      severity: 'critical',
      title: 'Nightly Shopify fulfilment reconciliation could not load stores',
      error,
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  const shopifyCapabilityByBusiness = new Map<string, boolean>();
  let failedChannels = 0;
  let failedOrders = 0;
  for (const channel of channels) {
    const businessId = channel.business_id;
    const channelInstanceId = channel.channel_instance_id;
    try {
      let shopifyEnabled = shopifyCapabilityByBusiness.get(businessId);
      if (shopifyEnabled === undefined) {
        shopifyEnabled = (await getOnlineChannelCapabilities(businessId)).shopifyEnabled;
        shopifyCapabilityByBusiness.set(businessId, shopifyEnabled);
      }
      if (!shopifyEnabled) {
        results.push({ businessId, channelInstanceId, disabled: true, reason: 'shopify_disabled' });
        continue;
      }
      const result = await runImsForBusiness(businessId, () => reconcileShopifyFulfilmentsForChannel({
        businessId, channelInstanceId, windowStart, windowEnd,
      }));
      results.push({ businessId, ...result });

      if (result.repaired.length > 0) {
        await reportRuntimeIssue({
          businessId,
          source: 'shopify.orders',
          operation: 'fulfilment_reconciliation_backfill',
          severity: 'warning',
          title: 'Shopify fulfilments were repaired by nightly reconciliation',
          error: 'The usual Shopify webhook pathway did not bring these Sales Orders up to date.',
          context: {
            channelInstanceId,
            windowStart,
            windowEnd,
            repairedCount: result.repaired.length,
            salesOrderIds: result.repaired.map(item => item.salesOrderId),
            shopifyOrderIds: result.repaired.map(item => item.shopifyOrderId),
          },
          reference: { type: 'sales_channel_instance', id: channelInstanceId },
        });
      }

      const unresolvedCount = result.failures.length + result.reviewRequired.length;
      failedOrders += unresolvedCount;
      if (unresolvedCount > 0) {
        await reportRuntimeIssue({
          businessId,
          source: 'shopify.orders',
          operation: 'fulfilment_reconciliation_failed',
          title: 'Shopify fulfilments require reconciliation review',
          error: 'Some fully fulfilled Shopify orders could not be reconciled automatically.',
          context: {
            channelInstanceId,
            windowStart,
            windowEnd,
            failures: result.failures,
            reviewRequired: result.reviewRequired,
          },
          reference: { type: 'sales_channel_instance', id: channelInstanceId },
        });
      }
    } catch (error) {
      failedChannels += 1;
      await reportRuntimeIssue({
        businessId,
        source: 'shopify.orders',
        operation: 'fulfilment_reconciliation_failed',
        title: 'Nightly Shopify fulfilment reconciliation failed for store',
        error,
        context: { channelInstanceId, windowStart, windowEnd },
        reference: { type: 'sales_channel_instance', id: channelInstanceId },
      }).catch(() => null);
      results.push({
        businessId,
        channelInstanceId,
        error: error instanceof Error ? error.message : 'Shopify fulfilment reconciliation failed.',
      });
    }
  }

  const totals = results.reduce((summary, result: any) => ({
    scanned: summary.scanned + Number(result.scanned ?? 0),
    providerFulfilled: summary.providerFulfilled + Number(result.providerFulfilled ?? 0),
    repaired: summary.repaired + Number(result.repaired?.length ?? 0),
    alreadyCurrent: summary.alreadyCurrent + Number(result.alreadyCurrent ?? 0),
    missingLocal: summary.missingLocal + Number(result.missingLocal?.length ?? 0),
    reviewRequired: summary.reviewRequired + Number(result.reviewRequired?.length ?? 0),
  }), { scanned: 0, providerFulfilled: 0, repaired: 0, alreadyCurrent: 0, missingLocal: 0, reviewRequired: 0 });
  const status = failedChannels === 0 && failedOrders === 0 ? 200 : 207;
  console.info('[cron] shopify-fulfilment-reconciliation', JSON.stringify({
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    durationMs: Date.now() - startedAt,
    windowStart,
    windowEnd,
    channels: channels.length,
    failedChannels,
    failedOrders,
    ...totals,
    status,
  }));
  return NextResponse.json({
    success: status === 200,
    windowStart,
    windowEnd,
    channels: channels.length,
    failedChannels,
    failedOrders,
    ...totals,
    results,
  }, { status });
}