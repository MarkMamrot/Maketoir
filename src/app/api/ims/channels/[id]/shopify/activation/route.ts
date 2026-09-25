import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { assertShopifyEnabled, isOnlineChannelDisabledError } from '@/lib/ims/businessOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export async function POST(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    await assertShopifyEnabled(businessId);
    const body = await request.json();
    if (typeof body?.active !== 'boolean') return NextResponse.json({ error: 'Active must be true or false.' }, { status: 400 });
    const instance = await SalesChannelInstanceRepository.setShopifyActivationForBusiness({
      businessId, channelInstanceId, active: body.active,
    });
    if (!instance) return NextResponse.json({ success: false,
      error: body.active ? 'Test this Shopify connection successfully before activation.' : 'Shopify channel not found.' }, { status: 409 });
    return NextResponse.json({ success: true, instance });
  } catch (error) {
    if (isOnlineChannelDisabledError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
    }
    await reportRuntimeIssue({ businessId, source: 'ims.channels', operation: 'shopify_activation',
      title: 'Shopify channel activation could not be changed', error, context: {},
      reference: { type: 'sales_channel_instance', id: channelInstanceId } }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Shopify channel activation could not be changed.' }, { status: 500 });
  }
}