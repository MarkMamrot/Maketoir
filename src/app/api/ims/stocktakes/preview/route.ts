import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';

export async function GET(req: NextRequest) {
  try {
    await getImportSession();
    const sp = req.nextUrl.searchParams;
    const location_id = sp.get('location_id') ? parseInt(sp.get('location_id')!, 10) : undefined;
    const brand_id    = sp.get('brand_id')    ? parseInt(sp.get('brand_id')!,    10) : undefined;
    const supplier_id = sp.get('supplier_id') ? parseInt(sp.get('supplier_id')!, 10) : undefined;
    const product_type = sp.get('product_type') || undefined;
    if (!location_id) return NextResponse.json({ error: 'location_id required' }, { status: 400 });
    const count = await ImsStocktakeRepo.previewVariants({ location_id, brand_id, supplier_id, product_type });
    return NextResponse.json({ count });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
