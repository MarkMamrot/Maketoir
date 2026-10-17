import { NextResponse } from 'next/server';

import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { processShopifyOrderEvent } from '@/lib/channels/shopifyOrderProcessing';
import { ShopifyOrderImportPendingError } from '@/lib/channels/shopifyOrderUpdate';
import { getImsDbNameStrict, runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
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
        const createdAt = payload.created_at;
        if (createdAt != null && typeof createdAt !== 'string') {
          throw new Error('Shopify event creation timestamp is invalid.');
        }
        const orderDate = toBusinessDate(createdAt);
        if (settings.orders.syncFrom && orderDate < settings.orders.syncFrom) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'ignored' });
          return { eventStatus: 'ignored' as const };
        }
        const processed = await processShopifyOrderEvent({
          businessId: verified!.businessId,
          channelInstanceId: verified!.channelInstanceId,
          locationId: settings.orders.locationId,
          topic: verified!.topic,
          eventId: verified!.webhookId,
          payload,
        });
        await finishShopifyWebhookEvent({ webhook: verified!, status: processed.eventStatus });
        return processed;
      } catch (error) {
        if (error instanceof ShopifyOrderImportPendingError) {
          await finishShopifyWebhookEvent({ webhook: verified!, status: 'pending', safeError: error.message });
          throw error;
        }
        await finishShopifyWebhookEvent({
          webhook: verified!, status: 'failed',
          safeError: error instanceof Error ? error.message : 'Shopify order processing failed.',
        }).catch(() => null);
        throw error;
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ShopifyOrderImportPendingError) {
      return NextResponse.json({ ok: false, eventStatus: 'pending', error: 'Waiting for the normal order import.' },
        { status: 503, headers: { 'Retry-After': '30' } });
    }
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