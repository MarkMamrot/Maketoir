import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  createAmazonExistingAsinMapping,
  listAmazonMappings,
  searchAmazonMappingCandidates,
  setAmazonMappingControls,
} from '@/lib/channels/amazonMappingRepository';
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

export async function GET(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  try {
    const search = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (search) return NextResponse.json({ success: true, candidates: await searchAmazonMappingCandidates({ ...auth, search }) });
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
    if (updated > 0) await SalesChannelInstanceRepository.invalidateAmazonReadinessForBusiness(auth);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'update_amazon_mappings',
      title: 'Amazon product controls could not be saved', error,
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId }, context: { provider: 'amazon' } }).catch(() => null);
    return NextResponse.json({ error: 'Amazon product controls could not be saved.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const auth = await authorize(context);
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const variantId = String(body?.variantId ?? '').trim();
  const asin = String(body?.asin ?? '').trim();
  const sellerSku = String(body?.sellerSku ?? '').trim();
  if (!variantId || !asin || !sellerSku) {
    return NextResponse.json({ error: 'Variant, ASIN and seller SKU are required.' }, { status: 400 });
  }
  try {
    await createAmazonExistingAsinMapping({ ...auth, variantId, asin, sellerSku });
    await SalesChannelInstanceRepository.invalidateAmazonReadinessForBusiness(auth);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/valid|between|not found/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'That IMS variant or seller SKU is already mapped in this Amazon account.' }, { status: 409 });
    }
    await reportRuntimeIssue({ businessId: auth.businessId, source: 'ims.channels', operation: 'create_amazon_offer_mapping',
      title: 'Amazon existing-ASIN mapping could not be created', error,
      reference: { type: 'sales_channel_instance', id: auth.channelInstanceId }, context: { variantId, asin } }).catch(() => null);
    return NextResponse.json({ error: 'Amazon existing-ASIN mapping could not be created.' }, { status: 500 });
  }
}