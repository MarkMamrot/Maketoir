import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  SalesChannelInstanceRepository,
  SalesChannelValidationError,
} from '@/lib/channels/channelInstanceRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export async function PATCH(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }

  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Channel instance ID is required.' }, { status: 400 });

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new SalesChannelValidationError('A channel update is required.');
    }
    if (Object.keys(body).some(key => key !== 'displayName')) {
      throw new SalesChannelValidationError('Only the channel display name can be changed here.');
    }
    if (typeof body.displayName !== 'string') {
      throw new SalesChannelValidationError('Channel display name must be text.');
    }

    const instance = await SalesChannelInstanceRepository.renameForBusiness({
      businessId,
      channelInstanceId,
      displayName: body.displayName,
    });
    if (!instance) return NextResponse.json({ success: false, error: 'Sales channel not found.' }, { status: 404 });
    return NextResponse.json({ success: true, instance });
  } catch (error) {
    if (error instanceof SalesChannelValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ success: false, error: error instanceof SyntaxError ? 'Invalid request body.' : error.message }, { status: 400 });
    }
    await reportRuntimeIssue({
      businessId,
      source: 'ims.channels',
      operation: 'rename',
      title: 'Sales channel could not be renamed',
      error,
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
      context: {},
    });
    return NextResponse.json({ success: false, error: 'Sales channel could not be renamed.' }, { status: 500 });
  }
}
