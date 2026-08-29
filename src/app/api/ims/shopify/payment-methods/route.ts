import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { ShopifyService } from '@/services/ShopifyService';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET() {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId = session.businessId;
  const disabled = await shopifyDisabledResponse(businessId); if (disabled) return disabled;
  const credentials = await getShopifyAdminCredentials(businessId);
  if (!credentials) {
    return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });
  }

  const shopify = new ShopifyService(credentials.shopDomain, credentials.token);
  const syncFromRows = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'shopify_order_sync_from' LIMIT 1",
    [businessId],
  ).catch(() => [] as { value: string }[]);
  const syncFrom = syncFromRows[0]?.value || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  try {
    const orders = await shopify.getAllOrders(syncFrom);
    const methods = new Map<string, { gateway_name: string; display_name: string; order_count: number; example_order: string | null }>();
    for (const order of orders) {
      const gateways = Array.isArray(order.payment_gateway_names) && order.payment_gateway_names.length > 0
        ? order.payment_gateway_names
        : [order.payment_gateway_name || order.gateway || 'Unknown'];
      for (const raw of gateways) {
        const gateway_name = String(raw ?? 'Unknown').trim().toLowerCase() || 'unknown';
        const existing = methods.get(gateway_name) ?? { gateway_name, display_name: raw ?? 'Unknown', order_count: 0, example_order: null };
        existing.order_count += 1;
        existing.display_name = raw ?? existing.display_name;
        existing.example_order = existing.example_order ?? String(order.name ?? order.order_number ?? order.id ?? '');
        methods.set(gateway_name, existing);
      }
    }
    return NextResponse.json({ success: true, methods: Array.from(methods.values()).sort((a, b) => a.display_name.localeCompare(b.display_name)) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}