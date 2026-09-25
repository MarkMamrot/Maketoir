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
