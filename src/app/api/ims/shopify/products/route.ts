import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';


export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;
  try {
    const channelInstanceId = new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
    if (!channelInstanceId) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });
    await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    const products = await ImsShopifyRepo.listWithShopifyStatus(session.businessId, channelInstanceId);
    return NextResponse.json({ success: true, data: products });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
