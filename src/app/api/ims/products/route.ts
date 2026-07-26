import { NextResponse } from 'next/server';
import { ImsProductsRepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';
import { isReservedShopifyFallbackSku } from '@/lib/shopifyFallbackVariant';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsProductsRepo.list(businessId);
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
    if (isReservedShopifyFallbackSku(body?.base_sku)) {
      return NextResponse.json(
        { success: false, error: 'SHOPIFY-MISC is reserved for the Shopify system fallback product.' },
        { status: 403 },
      );
    }
    const product_id = await ImsProductsRepo.create(body, businessId);
    return NextResponse.json({ success: true, product_id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
