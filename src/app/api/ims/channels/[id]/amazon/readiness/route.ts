import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { assessAmazonReadiness } from '@/lib/channels/amazonReadiness';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_request: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  try {
    const result = await assessAmazonReadiness({ businessId, channelInstanceId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'amazon.readiness', operation: 'check_activation_readiness',
      title: 'Amazon activation readiness could not be checked', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ success: false, error: 'Amazon activation readiness could not be checked.' }, { status: 500 });
  }
}