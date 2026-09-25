import { NextResponse } from 'next/server';

import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { applyShopifyPaidOrderLoyalty } from '@/lib/channels/shopifyPaidOrderLoyalty';
import { applyShopifyOrderFulfilment } from '@/lib/channels/shopifyOrderFulfilment';
import { cancelShopifyOrder, importShopifyOrder } from '@/lib/channels/shopifyOrderImport';
import { applyShopifyOrderRefund } from '@/lib/channels/shopifyOrderRefund';
import { updateShopifyOrder } from '@/lib/channels/shopifyOrderUpdate';
import { getImsDbNameStrict, runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
import { reconcileGiftCardsFromPaidShopifyOrder } from '@/lib/ims/shopifyGiftCardWebhook';
import { autoPostShopifyPayout } from '@/lib/ims/shopifyPayoutAutoPost';
import { getShopifyApiCreds, ingestShopifyPayout } from '@/lib/ims/shopifyPayoutIngestion';
import {
  ShopifyWebhookIngressError,
  claimShopifyWebhookEvent,
  finishShopifyWebhookEvent,
  stageShopifyWebhookEvent,
  verifyShopifyWebhook,
  type VerifiedShopifyWebhook,
} from '@/lib/channels/shopifyWebhookIngress';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { toBusinessDate } from '@/lib/shopifyDate';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: { channelInstanceId: string } }) {
  let verified: VerifiedShopifyWebhook | null = null;
  try {
    const rawBody = await request.text();
    verified = await verifyShopifyWebhook({
      channelInstanceId: context.params.channelInstanceId,
      rawBody,
      topic: request.headers.get('x-shopify-topic'),
      webhookId: request.headers.get('x-shopify-webhook-id'),
      shopDomain: request.headers.get('x-shopify-shop-domain'),
      hmac: request.headers.get('x-shopify-hmac-sha256'),
    });
    const instance = await SalesChannelInstanceRepository.getForBusiness(
      verified.businessId,
      verified.channelInstanceId,
    );
    if (!instance || instance.provider !== 'shopify') throw new Error('Shopify channel instance could not be reloaded.');
    const settings = shopifyInstanceSettings(instance.settings);
    const imsDbName = await getImsDbNameStrict(verified.businessId);
    if (!imsDbName) throw new Error('Tenant IMS database mapping is missing.');
    const result = await runImsForBusiness(verified.businessId, async () => {
      await stageShopifyWebhookEvent(verified!);
      if (!await claimShopifyWebhookEvent(verified!)) return { eventStatus: 'duplicate' as const };
      try {
        if (!['orders/create', 'orders/paid', 'orders/cancelled',
          'orders/updated', 'fulfillments/create', 'fulfillments/update', 'orders/fulfilled',
          'refunds/create', 'returns/update', 'shopify_payments/payouts/create',
          'shopify_payments/payouts/update'].includes(verified!.topic)) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'ignored' });
          return { eventStatus: 'ignored' as const };
        }
        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        if (verified!.topic.startsWith('shopify_payments/payouts/')) {
          const credentials = await getShopifyApiCreds(verified!.businessId, verified!.channelInstanceId);
          const ingested = await ingestShopifyPayout(
            verified!.businessId,
            verified!.channelInstanceId,
            payload,
            credentials,
          );
          await autoPostShopifyPayout(verified!.businessId, verified!.channelInstanceId, ingested.payoutId);
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, outcome: ingested.status };
        }
        if (!settings.orders.enabled) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'ignored' });
          return { eventStatus: 'ignored' as const };
        }
        if (verified!.topic === 'returns/update') {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, outcome: 'observed' as const };
        }
        const orderDate = toBusinessDate(payload.created_at);
        if (settings.orders.syncFrom && orderDate < settings.orders.syncFrom) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'ignored' });
          return { eventStatus: 'ignored' as const };
        }
        if (verified!.topic === 'orders/cancelled') {
          const cancelled = await cancelShopifyOrder({
            businessId: verified!.businessId,
            channelInstanceId: verified!.channelInstanceId,
            order: payload,
          });
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, outcome: cancelled.outcome, salesOrderId: cancelled.salesOrderId };
        }
        if (['fulfillments/create', 'fulfillments/update', 'orders/fulfilled'].includes(verified!.topic)) {
          const fulfilled = await applyShopifyOrderFulfilment({
            businessId: verified!.businessId,
            channelInstanceId: verified!.channelInstanceId,
            topic: verified!.topic as 'fulfillments/create' | 'fulfillments/update' | 'orders/fulfilled',
            payload,
          });
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, outcome: fulfilled.outcome, salesOrderId: fulfilled.salesOrderId };
        }
        if (verified!.topic === 'refunds/create') {
          const refunded = await applyShopifyOrderRefund({
            businessId: verified!.businessId,
            channelInstanceId: verified!.channelInstanceId,
            refund: payload,
          });
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, ...refunded };
        }
        if (verified!.topic === 'orders/updated') {
          const updated = await updateShopifyOrder({
            businessId: verified!.businessId,
            channelInstanceId: verified!.channelInstanceId,
            order: payload,
          });
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
          return { eventStatus: 'complete' as const, ...updated };
        }
        if (!settings.orders.locationId) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'ignored' });
          return { eventStatus: 'ignored' as const };
        }
        const imported = await importShopifyOrder({
          businessId: verified!.businessId,
          channelInstanceId: verified!.channelInstanceId,
          locationId: settings.orders.locationId,
          topic: verified!.topic,
          order: payload,
        });
        if (verified!.topic === 'orders/paid' && imported.salesOrderId) {
          await applyShopifyPaidOrderLoyalty({
            businessId: verified!.businessId,
            channelInstanceId: verified!.channelInstanceId,
            order: payload,
          });
          await reconcileGiftCardsFromPaidShopifyOrder(
            verified!.businessId,
            verified!.channelInstanceId,
            payload,
          );
        }
        await finishShopifyWebhookEvent({ webhook: verified!, status: 'complete' });
        return { eventStatus: 'complete' as const, outcome: imported.outcome, salesOrderId: imported.salesOrderId };
      } catch (error) {
        await finishShopifyWebhookEvent({
          webhook: verified!, status: 'failed',
          safeError: error instanceof Error ? error.message : 'Shopify order processing failed.',
        }).catch(() => null);
        throw error;
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ShopifyWebhookIngressError || isOnlineChannelDisabledError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (verified) {
      await reportRuntimeIssue({
        businessId: verified.businessId,
        source: 'shopify_webhook',
        operation: 'process_exact_instance_event',
        title: 'Exact-instance Shopify webhook could not be processed',
        error,
        context: { channelInstanceId: verified.channelInstanceId, topic: verified.topic },
        reference: { type: 'shopify_webhook', id: verified.webhookId },
      }).catch(() => null);
    }
    return NextResponse.json({ error: 'Shopify webhook could not be accepted.' }, { status: 500 });
  }
}