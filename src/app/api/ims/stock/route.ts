import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsStockRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const variantId  = searchParams.get('variant_id') ?? undefined;
    const locationId = searchParams.get('location_id') ? Number(searchParams.get('location_id')) : undefined;
    const data = await ImsStockRepo.list(variantId, locationId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
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
