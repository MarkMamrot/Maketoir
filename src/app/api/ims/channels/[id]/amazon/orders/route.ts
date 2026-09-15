import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { syncAmazonOrdersForChannel } from '@/lib/channels/amazonOrderSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export const runtime = 'nodejs';
export const maxDuration = 300;

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
      return NextResponse.json({ error: 'Amazon channel not found.' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const result = await syncAmazonOrdersForChannel({
      businessId, channelInstanceId,
      limit: Math.max(1, Math.min(100, Math.floor(Number(body?.limit ?? 25)))),
    });
    return NextResponse.json({ success: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 207 });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'amazon.orders', operation: 'sync_orders',
      title: 'Amazon orders could not be synchronized', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    });
    return NextResponse.json({ error: 'Amazon orders could not be synchronized.' }, { status: 502 });
  }
}