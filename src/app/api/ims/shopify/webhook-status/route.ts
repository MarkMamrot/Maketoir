import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import {
  reconcileShopifyWebhooks,
  SHOPIFY_EXACT_WEBHOOK_TOPICS,
} from '@/lib/channels/shopifyWebhookRegistration';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 60;

type WebhookStatusRow = {
  topic: string;
  provider_registration_id: string | null;
  registration_status: string;
  last_verified_at: string | null;
  safe_error: string | null;
};

function expectedUrl(request: Request, channelInstanceId: string): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const origin = forwardedHost ? `https://${forwardedHost.split(',')[0].trim()}` : new URL(request.url).origin;
  return `${origin}/api/webhooks/shopify/channels/${encodeURIComponent(channelInstanceId)}`;
}

function selectedInstanceId(request: Request): string {
  return new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
}

async function statusResponse(request: Request, businessId: string, channelInstanceId: string) {
  const context = await getShopifyOperationContext({ businessId, channelInstanceId });
  const rows = await query<WebhookStatusRow>(
    `SELECT topic, provider_registration_id, registration_status, last_verified_at, safe_error
       FROM sales_channel_webhooks WHERE channel_instance_id = ? ORDER BY topic`,
    [channelInstanceId],
  );
  const byTopic = new Map(rows.map(row => [row.topic, row]));
  const topics = SHOPIFY_EXACT_WEBHOOK_TOPICS.map(topic => {
    const row = byTopic.get(topic);
    return {
      topic,
      registrationId: row?.provider_registration_id ?? null,
      status: row?.registration_status ?? 'missing',
      lastVerifiedAt: row?.last_verified_at ?? null,
      error: row?.safe_error ?? null,
    };
  });
  return {
    success: true,
    channelInstanceId,
    displayName: context.instance.displayName,
    shopDomain: context.credentials.shopDomain,
    expectedUrl: expectedUrl(request, channelInstanceId),
    topics,
    allOk: topics.every(topic => topic.status === 'registered' && Boolean(topic.registrationId)),
  };
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const channelInstanceId = selectedInstanceId(request);
  if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Select a Shopify storefront.' }, { status: 400 });
  try {
    return NextResponse.json(await statusResponse(request, session.businessId, channelInstanceId));
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Webhook status unavailable.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const channelInstanceId = selectedInstanceId(request);
  if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Select a Shopify storefront.' }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await reconcileShopifyWebhooks({
      businessId: session.businessId,
      channelInstanceId,
      callbackUrl: expectedUrl(request, channelInstanceId),
      signingSecret: typeof body?.signingSecret === 'string' ? body.signingSecret : null,
    });
    return NextResponse.json({ ...(await statusResponse(request, session.businessId, channelInstanceId)), result });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_webhooks',
      operation: 'reconcile_exact_instance',
      title: 'Shopify webhooks could not be reconciled',
      error,
      context: { channelInstanceId },
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => undefined);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Webhook registration failed.' }, { status: 500 });
  }
}
