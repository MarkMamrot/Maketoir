import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  evaluateChannelProducts,
  listChannelRuleMatchedProductIds,
  listChannelProductRules,
  replaceChannelProductRules,
  setChannelProductOverride,
  setChannelProductOverrides,
} from '@/lib/channels/channelProductAssignmentRepository';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { channelProductAssignmentMode } from '@/lib/channels/types';
import type { ChannelProductOverrideMode, ChannelProductRuleDefinition } from '@/lib/channels/channelProductRules';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

type Authorized = {
  businessId: string;
  channelInstanceId: string;
  session: Awaited<ReturnType<typeof getImsSession>>;
  assignmentMode: ReturnType<typeof channelProductAssignmentMode>;
};

async function authorize(context: Context): Promise<Authorized | { response: NextResponse }> {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(context.params.id ?? '').trim();
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance) return { response: NextResponse.json({ error: 'Sales channel not found.' }, { status: 404 }) };
  return { businessId, channelInstanceId, session, assignmentMode: channelProductAssignmentMode(instance.settings) };
}

function pageInput(url: string) {
  const searchParams = new URL(url).searchParams;
  return {
    search: searchParams.get('search') ?? '',
    limit: Number(searchParams.get('limit') ?? 100),
    offset: Number(searchParams.get('offset') ?? 0),
  };
}

export async function GET(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get('matchesOnly') === '1') {
      const ruleId = String(searchParams.get('ruleId') ?? '').trim();
      const productIds = await listChannelRuleMatchedProductIds({
        ...auth,
        ruleId: ruleId === 'all' ? null : ruleId,
      });
      return NextResponse.json({ success: true, productIds });
    }
    const [rules, evaluation] = await Promise.all([
      listChannelProductRules(auth),
      evaluateChannelProducts({ ...auth, ...pageInput(request.url) }),
    ]);
    return NextResponse.json({ success: true, rules, ...evaluation });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.businessId, source: 'ims.channels', operation: 'load_product_rules',
      title: 'Channel product rules could not be loaded', error,
      context: { channelInstanceId: auth.channelInstanceId },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel product rules could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as { rules?: Array<Partial<ChannelProductRuleDefinition>> } | null;
  if (!Array.isArray(body?.rules)) return NextResponse.json({ error: 'A rule list is required.' }, { status: 400 });
  try {
    const rules = await replaceChannelProductRules({
      ...auth,
      rules: body.rules,
      actorUserId: Number(auth.session?.userId ?? 0) || null,
      actorName: String(auth.session?.name ?? auth.session?.email ?? '').trim() || null,
    });
    const evaluation = await evaluateChannelProducts({ ...auth, limit: 100 });
    return NextResponse.json({ success: true, rules, ...evaluation });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/requires|unsupported|at most/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    await reportRuntimeIssue({
      businessId: auth.businessId, source: 'ims.channels', operation: 'save_product_rules',
      title: 'Channel product rules could not be saved', error,
      context: { channelInstanceId: auth.channelInstanceId },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel product rules could not be saved.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = String(body?.productId ?? '').trim();
  const productIds = Array.isArray(body?.productIds) ? body.productIds.map(value => String(value).trim()).filter(Boolean) : [];
  const overrideMode = String(body?.overrideMode ?? '') as ChannelProductOverrideMode;
  if ((!productId && productIds.length === 0) || productIds.length > 500 || !['automatic', 'include', 'exclude'].includes(overrideMode)) {
    return NextResponse.json({ error: 'Between 1 and 500 valid products and an override are required.' }, { status: 400 });
  }
  try {
    const applied = productIds.length > 0
      ? await setChannelProductOverrides({ ...auth, productIds, overrideMode })
      : (await setChannelProductOverride({ ...auth, productId, overrideMode }), 1);
    return NextResponse.json({ success: true, applied });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.businessId, source: 'ims.channels', operation: 'override_product_assignment',
      title: 'Channel product override could not be saved', error,
      context: { channelInstanceId: auth.channelInstanceId, productId: productId || undefined, productCount: productIds.length || 1 },
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Channel product override could not be saved.' }, { status: 500 });
  }
}
