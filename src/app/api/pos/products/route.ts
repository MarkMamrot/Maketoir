import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function GET(req: Request) {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  const session      = posSession ?? adminSession;
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session', 'marketoir_session']);

  const { searchParams } = new URL(req.url);
  const rawId      = searchParams.get('location_id') ?? String(session.location_id ?? 0);
  const locationId = parseInt(rawId, 10);

  if (!locationId || isNaN(locationId) || locationId <= 0) {
    return NextResponse.json({ error: 'location_id is required.' }, { status: 400 });
  }

  // POS cashiers may only fetch products for their own assigned location
  if (posSession && locationId !== posSession.location_id) {
    return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
  }

  // Images are NOT included here — served by GET /api/pos/products/images,
  // cached client-side for 24 h. This keeps the frequent 5-min stock sync fast.
  const rows = await imsQuery<{
    variant_id:          string;
    product_id:          string;
    sku:                 string | null;
    barcode:             string | null;
    product_name:        string;
    brand:               string | null;
    option1_name:        string | null;
    option1_value:       string | null;
    option2_name:        string | null;
    option2_value:       string | null;
    option3_name:        string | null;
    option3_value:       string | null;
    cost:                string | null;
    price:               string | null;
    price_rrp_sale:      string | null;
    discount_start_date: string | null;
    discount_end_date:   string | null;
    qty_on_hand:         string | null;
    qty_on_hand_all:     string | null;
    qty_available:       string | null;
    qty_available_all:   string | null;
    is_active:           number;
  }>(
    `SELECT
       v.variant_id,
       v.product_id,
       v.sku,
       v.barcode,
       p.name        AS product_name,
       p.brand,
       v.option1_name,
       v.option1_value,
       v.option2_name,
       v.option2_value,
       v.option3_name,
       v.option3_value,
       v.cost_aud  AS cost,
       v.price_rrp AS price,
       v.price_rrp_sale,
       v.discount_start_date,
       v.discount_end_date,
       COALESCE(s.qty_on_hand, 0)                                      AS qty_on_hand,
       COALESCE(sall.total_on_hand, 0)                                  AS qty_on_hand_all,
       COALESCE(s.qty_on_hand, 0) - COALESCE(s.qty_committed, 0)       AS qty_available,
       COALESCE(sall.total_available, 0)                                AS qty_available_all,
       v.is_active
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     LEFT JOIN (
       SELECT variant_id,
              SUM(qty_on_hand)                            AS total_on_hand,
              SUM(qty_on_hand - COALESCE(qty_committed,0)) AS total_available
       FROM ims_stock
       GROUP BY variant_id
     ) sall ON sall.variant_id = v.variant_id
     WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
     ORDER BY p.name, v.sku`,
    [locationId, session.businessId],
  );

  const tz    = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

  const products = rows.map((r) => {
    const opts = [r.option1_value, r.option2_value, r.option3_value]
      .filter(Boolean)
      .join(' / ');

    const rrp       = r.price != null ? Number(r.price) : 0;
    const discPrice = r.price_rrp_sale != null ? Number(r.price_rrp_sale) : null;
    const inDiscountWindow =
      discPrice != null &&
      discPrice > 0 &&
      r.discount_start_date != null &&
      r.discount_end_date   != null &&
      today >= r.discount_start_date.slice(0, 10) &&
      today <= r.discount_end_date.slice(0, 10);
    const effectivePrice = inDiscountWindow ? discPrice! : rrp;

    return {
      variant_id:     r.variant_id,
      product_id:     r.product_id,
      code:           r.sku,
      barcode:        r.barcode,
      name:           opts ? `${r.product_name} — ${opts}` : r.product_name,
      brand:          r.brand,
      price:          effectivePrice,
      original_price: inDiscountWindow ? rrp : null,
      cost:           r.cost != null ? Number(r.cost) : null,
      soh:            Number(r.qty_on_hand ?? 0),
      soh_all:        Number(r.qty_on_hand_all ?? 0),
      available:      Number(r.qty_available ?? 0),
      available_all:  Number(r.qty_available_all ?? 0),
      image_url:      null as string | null, // merged client-side from image cache
    };
  });

  return NextResponse.json({ products, location_id: locationId });
}
