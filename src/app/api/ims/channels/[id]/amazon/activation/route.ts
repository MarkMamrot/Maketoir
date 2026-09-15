import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { AmazonActivationBlockedError, setAmazonActivation } from '@/lib/channels/amazonActivation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  const body = await request.json().catch(() => null) as { active?: unknown } | null;
  if (typeof body?.active !== 'boolean') {
    return NextResponse.json({ error: 'An activation state is required.' }, { status: 400 });
  }
  try {
    const result = await setAmazonActivation({
      businessId,
      channelInstanceId,
      active: body.active,
      actorUserId: Number(session.userId ?? 0) || null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AmazonActivationBlockedError) {
      return NextResponse.json({ success: false, error: error.message, checks: error.checks }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId, source: 'amazon.activation', operation: body.active ? 'activate' : 'deactivate',
      title: `Amazon channel could not be ${body.active ? 'activated' : 'deactivated'}`, error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ success: false, error: `Amazon channel could not be ${body.active ? 'activated' : 'deactivated'}.` }, { status: 500 });
  }
}