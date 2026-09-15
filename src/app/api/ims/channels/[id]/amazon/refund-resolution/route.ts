import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import {
  listAmazonRefundResolutionGroups,
  resolveAmazonRefundPair,
} from '@/lib/channels/amazonRefundReconciliation';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

export const runtime = 'nodejs';
export const maxDuration = 60;

async function authorize(params: Context['params']) {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(params.id ?? '').trim();
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance || instance.provider !== 'amazon') {
    return { response: NextResponse.json({ error: 'Amazon channel not found.' }, { status: 404 }) };
  }
  return { session, businessId, channelInstanceId };
}

export async function GET(_request: Request, { params }: Context) {
  const auth = await authorize(params);
  if ('response' in auth) return auth.response;
  const { businessId, channelInstanceId } = auth;
  try {
    const groups = await runImsForBusiness(businessId, () => listAmazonRefundResolutionGroups({
      businessId, channelInstanceId,
    }));
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    await reportRuntimeIssue({
      businessId, source: 'amazon.refunds', operation: 'list_refund_ambiguities',
      title: 'Amazon refund ambiguities could not be loaded', error,
      context: { channelInstanceId }, reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Amazon refund ambiguities could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const auth = await authorize(params);
  if ('response' in auth) return auth.response;
  const { session, businessId, channelInstanceId } = auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const amazonOrderId = String(body?.amazonOrderId ?? '').trim();
  const amazonRmaId = String(body?.amazonRmaId ?? '').trim();
  const amazonRefundId = String(body?.amazonRefundId ?? '').trim();
  if (!amazonOrderId || !amazonRmaId || !amazonRefundId) {
    return NextResponse.json({ error: 'Select an Amazon order, return, and refund.' }, { status: 400 });
  }
  try {
    const result = await runImsForBusiness(businessId, async () => {
      const resolved = await resolveAmazonRefundPair({
        businessId, channelInstanceId, amazonOrderId, amazonRmaId, amazonRefundId,
        createdBy: String(session.name ?? session.email ?? session.userId ?? 'Amazon reconciliation'),
      });
      const groups = await listAmazonRefundResolutionGroups({ businessId, channelInstanceId });
      return { ...resolved, groups };
    });
    await SalesChannelInstanceRepository.setAmazonRefundAmbiguityForBusiness({
      businessId, channelInstanceId, ambiguousCount: result.groups.length,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The selected Amazon refund pair could not be resolved.';
    if (message.includes('not a valid pair') || message.includes('already linked') || message.includes('has not been imported')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId, source: 'amazon.refunds', operation: 'resolve_refund_ambiguity',
      title: 'Amazon refund ambiguity could not be resolved', error,
      context: { channelInstanceId, amazonOrderId, amazonRmaId, amazonRefundId },
      reference: { type: 'sales_channel_instance', id: channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'The selected Amazon refund pair could not be resolved.' }, { status: 500 });
  }
}
