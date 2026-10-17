import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { importShopifyOrder } from '@/lib/channels/shopifyOrderImport';
import { applyShopifyOrderRefund } from '@/lib/channels/shopifyOrderRefund';
import { updateShopifyOrder } from '@/lib/channels/shopifyOrderUpdate';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { ShopifyService } from '@/services/ShopifyService';
import { getOnlineSyncControl } from '@/lib/channels/onlineSyncControl';
import { requestOnlineRecovery } from '@/lib/channels/onlineRecoveryWorker';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { OnlineSyncLeaseLostError } from '@/lib/channels/onlineSyncPolicy';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId);
  const disabled = await shopifyDisabledResponse(businessId);
  if (disabled) return disabled;
  const body = await request.json().catch(() => ({}));
  const channelInstanceId = String(body?.channelInstanceId ?? '').trim();
  if (!channelInstanceId) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });

  try {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    const settings = shopifyInstanceSettings(context.instance.settings);
    if (!settings.orders.enabled) {
      return NextResponse.json({ error: 'Order import is disabled for this storefront.' }, { status: 400 });
    }
    if (!settings.orders.syncFrom || !settings.orders.locationId) {
      return NextResponse.json({ error: 'Configure the order start date and location for this storefront.' }, { status: 400 });
    }

    try {
      const control = await runImsForBusiness(businessId, () => getOnlineSyncControl(businessId));
      if (control.mode !== 'legacy') {
        if (control.paused) {
          return NextResponse.json({ error: 'Resume scheduled recovery before requesting an import.' }, { status: 409 });
        }
        await runImsForBusiness(businessId, () => requestOnlineRecovery(businessId, channelInstanceId));
        return NextResponse.json({ success: true, queued: true, channelInstanceId }, { status: 202 });
      }
    } catch (error) {
      if (error instanceof OnlineSyncLeaseLostError) {
        return NextResponse.json({ error: 'Background recovery is paused or unavailable for this business.' }, { status: 409 });
      }
      await reportRuntimeIssue({
        businessId, source: 'online_recovery', operation: 'manual_import_handoff',
        title: 'Manual Shopify recovery could not be queued', error: new Error('Recovery handoff failed.'),
        context: { channelInstanceId },
      });
      return NextResponse.json({ error: 'Shopify recovery could not be queued.' }, { status: 503 });
    }

    const orders = await new ShopifyService(context.credentials.shopDomain, context.credentials.token)
      .getAllOrders(settings.orders.syncFrom);
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let refunded = 0;
    const errors: string[] = [];
    let newestUpdatedAt = settings.orders.lastUpdatedAt;

    for (const order of orders) {
      try {
        const result = await importShopifyOrder({
          businessId,
          channelInstanceId,
          locationId: settings.orders.locationId,
          topic: String(order.financial_status).toLowerCase() === 'paid' ? 'orders/paid' : 'orders/create',
          order,
        });
        if (result.outcome === 'imported') imported += 1;
        else if (result.outcome === 'updated') {
          await updateShopifyOrder({ businessId, channelInstanceId, order });
          updated += 1;
        } else skipped += 1;

        for (const refund of Array.isArray(order.refunds) ? order.refunds : []) {
          await applyShopifyOrderRefund({ businessId, channelInstanceId, refund: { ...refund, order_id: order.id } });
          refunded += 1;
        }
        const updatedAt = String(order.updated_at ?? '').trim();
        if (updatedAt && (!newestUpdatedAt || updatedAt > newestUpdatedAt)) newestUpdatedAt = updatedAt;
      } catch (error) {
        errors.push(`${order.name ?? order.id}: ${error instanceof Error ? error.message : 'Import failed.'}`);
      }
    }

    if (errors.length === 0 && newestUpdatedAt !== settings.orders.lastUpdatedAt) {
      await SalesChannelInstanceRepository.setShopifySettingsForBusiness({
        businessId,
        channelInstanceId,
        settings: { ...settings, orders: { ...settings.orders, lastUpdatedAt: newestUpdatedAt } },
      });
    }
    return NextResponse.json({
      success: errors.length === 0,
      channelInstanceId,
      imported,
      updated,
      skipped,
      refunded,
      errors,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Shopify order import failed.' }, { status: 400 });
  }
}
