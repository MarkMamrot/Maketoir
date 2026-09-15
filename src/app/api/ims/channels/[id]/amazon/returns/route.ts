import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { syncAmazonReturnsForChannel } from '@/lib/channels/amazonReturnSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(_request: Request, { params }: Context) {
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
      return NextResponse.json({ error: 'Amazon channel not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...await syncAmazonReturnsForChannel({ businessId, channelInstanceId }) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'amazon.returns', operation: 'manual_returns_sync',
      title: 'Amazon returns could not be synchronized', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    });
    return NextResponse.json({ error: 'Amazon returns could not be synchronized.' }, { status: 502 });
  }
}