import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// GET /api/pos/stock?variant_id=XXX
// Returns stock-on-hand per location for a single variant.
// Accessible by POS users (pos_session cookie).
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const variantId = searchParams.get('variant_id');
  if (!variantId) {
    return NextResponse.json({ success: false, error: 'variant_id is required.' }, { status: 400 });
  }

  try {
    const [descRows, stockRows, imageRows] = await Promise.all([
      imsQuery<{ description: string | null }>(
        `SELECT p.description FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE v.variant_id = ? AND p.business_id = ? LIMIT 1`,
        [variantId, session.businessId],
      ),
      imsQuery<{ location_name: string; qty_on_hand: number }>(
        `SELECT l.name AS location_name, s.qty_on_hand
         FROM ims_stock s
         JOIN ims_locations l ON l.id = s.location_id
         WHERE s.variant_id = ? AND l.business_id = ?
         ORDER BY l.name`,
        [variantId, session.businessId],
      ),
      // Full-resolution primary image, fetched on-demand for this one product
      // only — the bulk product cache only ever carries a small thumbnail.
      imsQuery<{ url: string }>(
        `SELECT i.url
         FROM ims_product_variants v
         JOIN ims_product_images i ON i.product_id = v.product_id
         WHERE v.variant_id = ?
         ORDER BY i.is_primary DESC, i.sort_order ASC
         LIMIT 1`,
        [variantId],
      ),
    ]);

    const description = descRows[0]?.description ?? null;
    const image_url = imageRows[0]?.url ?? null;
    return NextResponse.json({ success: true, data: stockRows, description, image_url });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
