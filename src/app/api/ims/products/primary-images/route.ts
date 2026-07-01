import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsProductsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/** GET /api/ims/products/primary-images
 *  Returns { [productId]: url } for every product that has at least one image.
 *  Intentionally separate from the main products list so products load fast
 *  and images are populated asynchronously afterwards.
 */
export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await ImsProductsRepo.listPrimaryImages(session.businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
