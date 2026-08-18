import { NextResponse } from 'next/server';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import { isReservedShopifyFallbackSku } from '@/lib/shopifyFallbackVariant';

export async function GET() {
  const session = await getImsSession(['marketoir_session', 'pos_session']);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsVariantsRepo.listAll(businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    if (isReservedShopifyFallbackSku(body?.sku)) {
      return NextResponse.json(
        { success: false, error: 'SHOPIFY-MISC is reserved for the Shopify system fallback variant.' },
        { status: 403 },
      );
    }
    const variant_id = await ImsVariantsRepo.create(body, businessId);
    return NextResponse.json({ success: true, variant_id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
