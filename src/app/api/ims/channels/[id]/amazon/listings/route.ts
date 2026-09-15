import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getAmazonChannelAccess } from '@/lib/channels/amazonCredentials';
import { syncAmazonListingMappings } from '@/lib/channels/amazonListingSync';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { listAmazonListings } from '@/lib/channels/amazonSpApi';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export async function POST(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
    if (!instance || instance.provider !== 'amazon') {
      return NextResponse.json({ error: 'Amazon sales channel not found.' }, { status: 404 });
    }
    const credentials = await getAmazonChannelAccess(businessId, channelInstanceId);
    if (!credentials) return NextResponse.json({ error: 'Amazon authorization is missing.' }, { status: 409 });
    const body = await request.json().catch(() => ({}));
    const page = await listAmazonListings(credentials.accessToken, credentials.sellerId, {
      pageSize: Number(body?.pageSize), nextToken: typeof body?.nextToken === 'string' ? body.nextToken : null,
    });
    const result = await syncAmazonListingMappings({ businessId, channelInstanceId, items: page.items });
    if (!page.nextToken) await SalesChannelInstanceRepository.markAmazonSetupOperationForBusiness({
      businessId, channelInstanceId, operation: 'listings',
    });
    return NextResponse.json({ success: true, ...result, processed: page.items.length, nextToken: page.nextToken });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'ims.channels', operation: 'sync_amazon_listings',
      title: 'Amazon listing sync failed', error,
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
      context: { provider: 'amazon' },
    }).catch(() => null);
    return NextResponse.json({ error: 'Amazon listings could not be synchronized.' }, { status: 502 });
  }
}