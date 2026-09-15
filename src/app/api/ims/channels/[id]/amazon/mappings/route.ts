import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listAmazonMappings, setAmazonMappingControls } from '@/lib/channels/amazonMappingRepository';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type Context = { params: { id: string } };

async function authorize(context: Context) {
  const session = await getImsSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  const businessId = String(session.businessId ?? '');
  const channelInstanceId = String(context.params.id ?? '').trim();
  const instance = await SalesChannelInstanceRepository.getForBusiness(businessId, channelInstanceId);
  if (!instance || instance.provider !== 'amazon') {
    return { response: NextResponse.json({ error: 'Amazon sales channel not found.' }, { status: 404 }) };
  }
  return { businessId, channelInstanceId };
}

export async function GET(_: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, mappings: await listAmazonMappings(auth) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'list_amazon_mappings',
      title: 'Amazon product mappings could not be loaded', error,
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId }, context: { provider: 'amazon' } }).catch(() => null);
    return NextResponse.json({ error: 'Amazon product mappings could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const mappingIds = Array.isArray(body?.mappingIds) ? body.mappingIds.map(Number) : [];
    const booleanOrUndefined = (value: unknown) => typeof value === 'boolean' ? value : undefined;
    if (mappingIds.length === 0 || mappingIds.length > 1000) {
      return NextResponse.json({ error: 'Choose between 1 and 1000 mappings.' }, { status: 400 });
    }
    const updated = await setAmazonMappingControls({ ...auth, mappingIds,
      selected: booleanOrUndefined(body?.selected), inventoryEnabled: booleanOrUndefined(body?.inventoryEnabled),
      priceEnabled: booleanOrUndefined(body?.priceEnabled) });
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'update_amazon_mappings',
      title: 'Amazon product controls could not be saved', error,
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId }, context: { provider: 'amazon' } }).catch(() => null);
    return NextResponse.json({ error: 'Amazon product controls could not be saved.' }, { status: 500 });
  }
}