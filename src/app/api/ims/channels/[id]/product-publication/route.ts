import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import {
  getChannelProductPublicationStatus,
  syncChannelProductPublications,
} from '@/lib/channels/channelProductPublication';
import { channelProductPublicationAdapter } from '@/lib/channels/channelProductPublicationAdapters';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

async function authorize(context: Context) {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) } as const;
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) } as const;
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(context.params.id ?? '').trim();
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance) return { response: NextResponse.json({ error: 'Sales channel not found.' }, { status: 404 }) } as const;
  return { businessId, channelInstanceId, instance } as const;
}

function publicationEnabled(settings: Record<string, unknown>): boolean {
  return settings.productPublicationEnabled === true || settings.productPublicationEnabled === 1;
}

export async function GET(_: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const status = await getChannelProductPublicationStatus({ ...auth, provider: auth.instance.provider });
    return NextResponse.json({ success: true, enabled: publicationEnabled(auth.instance.settings), ...status });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'publication_status',
      title: 'Channel product publication status could not be loaded', error,
      context: { channelInstanceId: auth.channelInstanceId }, reference: { type: 'sales_channel_instance', id: auth.channelInstanceId } }).catch(() => null);
    return NextResponse.json({ error: 'Channel product publication status could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'Enabled must be true or false.' }, { status: 400 });
  const instance = await SalesChannelInstanceRepository.setProductPublicationEnabledForBusiness({
    businessId: auth.businessId, channelInstanceId: auth.channelInstanceId, enabled: body.enabled,
  });
  return NextResponse.json({ success: true, enabled: publicationEnabled(instance?.settings ?? {}) });
}

export async function POST(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  if (!publicationEnabled(auth.instance.settings)) {
    return NextResponse.json({ error: 'Product publication is disabled for this channel.' }, { status: 409 });
  }
  if (!auth.instance.enabled || auth.instance.runtimeStatus !== 'active' || auth.instance.readinessStatus !== 'ready') {
    return NextResponse.json({ error: 'The channel must be enabled, active and ready before publishing products.' }, { status: 409 });
  }
  const body = await request.json().catch(() => ({})) as { enqueue?: unknown; limit?: unknown };
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit ?? 25) || 25)));
  try {
    const result = await syncChannelProductPublications({
      businessId: auth.businessId, channelInstanceId: auth.channelInstanceId, provider: auth.instance.provider,
      adapter: channelProductPublicationAdapter(auth.instance.provider), enqueue: body.enqueue !== false, limit,
    });
    const status = await getChannelProductPublicationStatus({ ...auth, provider: auth.instance.provider });
    return NextResponse.json({ success: true, ...result, status });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'run_product_publication',
      title: 'Channel product publication could not run', error,
      context: { channelInstanceId: auth.channelInstanceId, provider: auth.instance.provider },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId } }).catch(() => null);
    return NextResponse.json({ error: 'Channel product publication could not run.' }, { status: 500 });
  }
}