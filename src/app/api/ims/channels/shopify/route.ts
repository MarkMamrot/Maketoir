import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { saveShopifyChannel, ShopifyChannelValidationError } from '@/lib/channels/shopifyChannelRepository';
import { assertShopifyEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { ShopifyAuthMode } from '@/lib/shopifyCredentials';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  try {
    await assertShopifyEnabled(businessId);
    const body = await request.json();
    const channelInstanceId = await saveShopifyChannel({
      businessId,
      displayName: String(body?.displayName ?? ''),
      shopDomain: String(body?.shopDomain ?? ''),
      authMode: String(body?.authMode ?? '') as ShopifyAuthMode,
      accessToken: String(body?.accessToken ?? ''),
      clientId: String(body?.clientId ?? ''),
      clientSecret: String(body?.clientSecret ?? ''),
    });
    return NextResponse.json({ success: true, channelInstanceId });
  } catch (error) {
    if (error instanceof ShopifyChannelValidationError || error instanceof SyntaxError || isOnlineChannelDisabledError(error)) {
      const status = isOnlineChannelDisabledError(error) ? error.status : 400;
      return NextResponse.json({ success: false, error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status });
    }
    await reportRuntimeIssue({ businessId, source: 'ims.channels', operation: 'create_shopify_channel',
      title: 'Shopify channel could not be created', error, context: {} }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Shopify channel could not be created.' }, { status: 500 });
  }
}