import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { getAdminSession, getPosSession } from '@/lib/sessionUtils';

export async function GET(req: Request) {
  const posSession   = getPosSession();
  const adminSession = getAdminSession();
  const session      = adminSession ?? posSession;
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(adminSession ? ['marketoir_session'] : ['pos_session']);

  const { searchParams } = new URL(req.url);
  const rawId      = searchParams.get('location_id') ?? String(session.location_id ?? 0);
  const locationId = parseInt(rawId, 10);

  if (!locationId || isNaN(locationId) || locationId <= 0) {
    return NextResponse.json({ error: 'location_id is required.' }, { status: 400 });
  }

  // POS cashiers may only fetch products for their own assigned location
  if (!adminSession && posSession && locationId !== posSession.location_id) {
    return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
  }

  const since = searchParams.get('since');
  const serverTime = Date.now();
  const sinceDate = since ? new Date(Number(since)) : null;
  const isIncremental = !!(sinceDate && !isNaN(sinceDate.getTime()));

  // Images are NOT included here — served by GET /api/pos/products/images,
  // cached client-side for 24 h. This keeps the frequent 5-min stock sync fast.
  const baseSelect = `
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
     v.is_active,
     p.is_active AS product_is_active`;
  const baseFrom = `
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     LEFT JOIN (
       SELECT variant_id,
              SUM(qty_on_hand)                            AS total_on_hand,
              SUM(qty_on_hand - COALESCE(qty_committed,0)) AS total_available
       FROM ims_stock
       GROUP BY variant_id
     ) sall ON sall.variant_id = v.variant_id`;

  type Row = {
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
    product_is_active:   number;
  };

  let rows: Row[];
  let removed: string[] = [];

  if (isIncremental) {
    try {
      // Delta branch: relax the is_active filter so newly-deactivated rows are
      // still returned (routed into `removed` below) instead of silently
      // vanishing from the client's cache only at the next full resync.
      // A variant is included if its own/product identity changed, OR any
      // stock row for it (at ANY location) changed — the latter catches
      // qty movements at other locations that affect soh_all/available_all.
      rows = await imsQuery<Row>(
        `SELECT ${baseSelect} ${baseFrom}
         WHERE p.business_id = ?
           AND (
             v.updated_at > ? OR p.updated_at > ?
             OR EXISTS (SELECT 1 FROM ims_stock s2 WHERE s2.variant_id = v.variant_id AND s2.updated_at > ?)
           )
         ORDER BY p.name, v.sku`,
        [locationId, session.businessId, sinceDate, sinceDate, sinceDate],
      );
    } catch (e: any) {
      // Likely updated_at missing on this tenant (shouldn't happen for these
      // three tables per the base schema, but fail safe with a full fetch).
      rows = await imsQuery<Row>(
        `SELECT ${baseSelect} ${baseFrom}
         WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
         ORDER BY p.name, v.sku`,
        [locationId, session.businessId],
      );
    }
  } else {
    rows = await imsQuery<Row>(
      `SELECT ${baseSelect} ${baseFrom}
       WHERE v.is_active = 1 AND p.is_active = 1 AND p.business_id = ?
       ORDER BY p.name, v.sku`,
      [locationId, session.businessId],
    );
  }

  const timeZone = await getBusinessTimeZone(session.businessId);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone });

  const products = [];
  for (const r of rows) {
    if (isIncremental && (!r.is_active || !r.product_is_active)) {
      removed.push(r.variant_id);
      continue;
    }

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

    products.push({
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
    });
  }

  return NextResponse.json({ products, removed, server_time: serverTime, location_id: locationId });
}
