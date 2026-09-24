import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import {
  CHANNEL_PRODUCT_ASSIGNMENT_MODES,
  channelProductAssignmentMode,
  type ChannelProductAssignmentMode,
} from '@/lib/channels/types';
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

export async function GET(_: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  return NextResponse.json({ success: true, mode: channelProductAssignmentMode(auth.instance.settings) });
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  const mode = String(body?.mode ?? '') as ChannelProductAssignmentMode;
  if (!CHANNEL_PRODUCT_ASSIGNMENT_MODES.includes(mode)) {
    return NextResponse.json({ error: 'A valid product assignment mode is required.' }, { status: 400 });
  }
  try {
    const instance = await SalesChannelInstanceRepository.setProductAssignmentModeForBusiness({
      businessId: auth.businessId,
      channelInstanceId: auth.channelInstanceId,
      mode,
    });
    return NextResponse.json({ success: true, mode: channelProductAssignmentMode(instance?.settings ?? {}) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.businessId,
      source: 'ims.channels',
      operation: 'set_product_assignment_mode',
      title: 'Channel product assignment mode could not be saved',
      error,
      context: { channelInstanceId: auth.channelInstanceId, mode },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel product assignment mode could not be saved.' }, { status: 500 });
  }
}