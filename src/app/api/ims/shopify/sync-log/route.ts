import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';


export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;
  try {
    const channelInstanceId = new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
    if (!channelInstanceId) return NextResponse.json({ error: 'Select a Shopify storefront.' }, { status: 400 });
    const data = await ImsShopifyRepo.getLog(50, session.businessId, channelInstanceId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
