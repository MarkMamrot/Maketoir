import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyChannelConfiguration, saveShopifyChannel, ShopifyChannelValidationError } from '@/lib/channels/shopifyChannelRepository';
import { assertShopifyEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { ShopifyAuthMode } from '@/lib/shopifyCredentials';

type Context = { params: { id: string } };

async function authorize() {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  return { businessId: String(session.businessId ?? '') };
}

export async function GET(_: Request, { params }: Context) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  const businessId = auth.businessId!;
  try {
    const configuration = await getShopifyChannelConfiguration({ businessId, channelInstanceId: params.id });
    if (!configuration) return NextResponse.json({ success: false, error: 'Shopify channel not found.' }, { status: 404 });
    return NextResponse.json({ success: true, configuration });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'ims.channels', operation: 'load_shopify_channel',
      title: 'Shopify channel configuration could not be loaded', error, context: {},
      reference: { type: 'sales_channel_instance', id: params.id } }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Shopify channel configuration could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  const businessId = auth.businessId!;
  try {
    await assertShopifyEnabled(businessId);
    const body = await request.json();
    const channelInstanceId = await saveShopifyChannel({
      businessId, channelInstanceId: params.id,
      displayName: String(body?.displayName ?? ''), shopDomain: String(body?.shopDomain ?? ''),
      authMode: String(body?.authMode ?? '') as ShopifyAuthMode,
      accessToken: String(body?.accessToken ?? ''), clientId: String(body?.clientId ?? ''),
      clientSecret: String(body?.clientSecret ?? ''),
    });
    return NextResponse.json({ success: true, channelInstanceId });
  } catch (error) {
    if (error instanceof ShopifyChannelValidationError || error instanceof SyntaxError || isOnlineChannelDisabledError(error)) {
      const status = isOnlineChannelDisabledError(error) ? error.status : 400;
      return NextResponse.json({ success: false, error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status });
    }
    await reportRuntimeIssue({ businessId, source: 'ims.channels', operation: 'update_shopify_channel',
      title: 'Shopify channel could not be updated', error, context: {},
      reference: { type: 'sales_channel_instance', id: params.id } }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Shopify channel could not be updated.' }, { status: 500 });
  }
}