import { NextResponse } from 'next/server';

import { POST as handleExactShopifyWebhook } from '@/app/api/webhooks/shopify/channels/[channelInstanceId]/route';
import { normalizeShopifyShopDomain } from '@/lib/shopifyCredentials';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';

type ExactInstanceRow = { channel_instance_id: string };

export async function POST(request: Request, context: { params: { businessId: string } }) {
  const businessId = String(context.params.businessId ?? '').trim();
  const topic = String(request.headers.get('x-shopify-topic') ?? '').trim().toLowerCase();
  const shopDomain = normalizeShopifyShopDomain(request.headers.get('x-shopify-shop-domain') ?? '');
  if (!businessId || !topic || !shopDomain) {
    return NextResponse.json({ error: 'Legacy Shopify webhook routing information is incomplete.' }, { status: 400 });
  }

  const rows = await query<ExactInstanceRow>(
    `SELECT instance.channel_instance_id
       FROM sales_channel_instances instance
       JOIN sales_channel_webhooks webhook
         ON webhook.channel_instance_id = instance.channel_instance_id
        AND webhook.topic = ?
        AND webhook.registration_status = 'registered'
      WHERE instance.business_id = ?
        AND instance.provider = 'shopify'
        AND instance.external_account_key = ?
        AND instance.is_enabled = 1
        AND instance.runtime_status = 'active'
        AND instance.readiness_status = 'ready'
      LIMIT 2`,
    [topic, businessId, shopDomain],
  );
  if (rows.length !== 1) {
    return NextResponse.json({
      error: 'This legacy Shopify webhook URL is retired. Register the exact storefront webhook URL.',
    }, { status: 410 });
  }

  return handleExactShopifyWebhook(request, {
    params: { channelInstanceId: rows[0].channel_instance_id },
  });
}
