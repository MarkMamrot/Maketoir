import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

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

  const { searchParams } = new URL(req.url);
  const variantId = searchParams.get('variant_id');
  if (!variantId) {
    return NextResponse.json({ success: false, error: 'variant_id is required.' }, { status: 400 });
  }

  try {
    const [descRows, stockRows] = await Promise.all([
      imsQuery<{ description: string | null }>(
        `SELECT p.description FROM ims_product_variants v
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE v.variant_id = ? LIMIT 1`,
        [variantId],
      ),
      imsQuery<{ location_name: string; qty_on_hand: number }>(
        `SELECT l.name AS location_name, s.qty_on_hand
         FROM ims_stock s
         JOIN ims_locations l ON l.id = s.location_id
         WHERE s.variant_id = ?
         ORDER BY l.name`,
        [variantId],
      ),
    ]);

    const description = descRows[0]?.description ?? null;
    return NextResponse.json({ success: true, data: stockRows, description });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
