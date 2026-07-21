import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsStockRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { enterImsForBusiness } from '@/lib/db/BusinessRegistry';


export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    await enterImsForBusiness(businessId);
    const { searchParams } = new URL(req.url);
    const variantId  = searchParams.get('variant_id') ?? undefined;
    const locationId = searchParams.get('location_id') ? Number(searchParams.get('location_id')) : undefined;
    const data = await ImsStockRepo.list(variantId, locationId, businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    await enterImsForBusiness(session.businessId as string);
    const body = await req.json();
    const { variant_id, location_id, ...rest } = body;
    await ImsStockRepo.upsert(variant_id, Number(location_id), rest);

    // EVENT-DRIVEN CACHE UPDATE: Refresh for explicit manual stock update
    if (variant_id) {
      refreshVariantCache([variant_id]).catch(err => console.error('Failed inline cache refresh for Stock manual update:', err));
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
