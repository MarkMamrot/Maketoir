import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';


export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;

  try {
    const body = await req.json().catch(() => ({}));
    const product_ids = body?.product_ids as string[];
    const channelInstanceId = String(body?.channelInstanceId ?? '').trim();
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'product_ids array required.' }, { status: 400 });
    }
    if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Select a Shopify storefront.' }, { status: 400 });
    await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    return NextResponse.json({
      success: false,
      error: 'Direct Shopify product creation is disabled. Assign products to the selected sales channel and use the approved publication workflow.',
    }, { status: 409 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
