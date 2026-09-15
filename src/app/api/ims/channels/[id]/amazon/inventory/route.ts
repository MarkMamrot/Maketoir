import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { enqueueAmazonInventoryJobs, processAmazonInventoryJobs } from '@/lib/channels/amazonInventorySync';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
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
    const body = await request.json().catch(() => ({})) as { enqueue?: unknown; limit?: unknown };
    const queued = body.enqueue === false ? 0 : await enqueueAmazonInventoryJobs({ businessId, channelInstanceId });
    const result = await processAmazonInventoryJobs({
      businessId,
      channelInstanceId,
      limit: Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 100))),
    });
    if (result.failed === 0) await SalesChannelInstanceRepository.markAmazonSetupOperationForBusiness({
      businessId, channelInstanceId, operation: 'inventory',
    });
    return NextResponse.json({ success: true, queued, ...result });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims.channels',
      operation: 'sync_amazon_inventory',
      title: 'Amazon inventory synchronization failed',
      error,
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
      context: { provider: 'amazon' },
    }).catch(() => null);
    return NextResponse.json({ error: 'Amazon inventory could not be synchronized.' }, { status: 502 });
  }
}