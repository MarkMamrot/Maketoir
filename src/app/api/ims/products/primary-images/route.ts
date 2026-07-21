import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsProductsRepo } from '@/lib/ims/ImsRepository';


/** GET /api/ims/products/primary-images[?ids=id1,id2,...]
 *  Returns { [productId]: url } for products that have at least one image.
 *  When ?ids= is supplied only those product IDs are queried (current-page optimisation).
 *  Without ?ids= the full set is returned (used for pre-warming).
 */
export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('ids');
    const ids = raw ? raw.split(',').filter(Boolean) : null;
    const data = await ImsProductsRepo.listPrimaryImages(session.businessId, ids ?? undefined);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
