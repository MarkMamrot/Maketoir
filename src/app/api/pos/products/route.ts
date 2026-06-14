import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

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

  const { searchParams } = new URL(req.url);
  const rawId    = searchParams.get('location_id') ?? String(session.location_id ?? 0);
  const locationId = parseInt(rawId, 10);

  if (!locationId || isNaN(locationId) || locationId <= 0) {
    return NextResponse.json({ error: 'location_id is required.' }, { status: 400 });
  }

  // POS cashiers may only fetch products for their own assigned location
  if (posSession && locationId !== posSession.location_id) {
    return NextResponse.json({ error: 'Not authorised for this location.' }, { status: 403 });
  }

  // Join IMS products + variants + stock at the given location
  const rows = await imsQuery<{
    variant_id:    string;
    product_id:    string;
    sku:           string | null;
    barcode:       string | null;
    product_name:  string;
    brand:         string | null;
    option1_name:  string | null;
    option1_value: string | null;
    option2_name:  string | null;
    option2_value: string | null;
    option3_name:  string | null;
    option3_value: string | null;
    cost:          string | null;
    price:         string | null;
    qty_on_hand:   string | null;
    is_active:     number;
  }>(
    `SELECT
       v.variant_id,
       v.product_id,
       v.sku,
       v.barcode,
       p.name  AS product_name,
       p.brand,
       v.option1_name,
       v.option1_value,
       v.option2_name,
       v.option2_value,
       v.option3_name,
       v.option3_value,
       v.cost,
       v.price,
       COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
       v.is_active
     FROM ims_product_variants v
     JOIN ims_products p ON p.product_id = v.product_id
     LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
     WHERE v.is_active = 1 AND p.is_active = 1
     ORDER BY p.name, v.sku`,
    [locationId],
  );

  // Build display name: product name + option values
  const products = rows.map((r) => {
    const opts = [r.option1_value, r.option2_value, r.option3_value]
      .filter(Boolean)
      .join(' / ');
    return {
      variant_id:  r.variant_id,
      product_id:  r.product_id,
      code:        r.sku,
      barcode:     r.barcode,
      name:        opts ? `${r.product_name} — ${opts}` : r.product_name,
      brand:       r.brand,
      price:       r.price != null ? Number(r.price) : 0,
      cost:        r.cost  != null ? Number(r.cost)  : null,
      soh:         Number(r.qty_on_hand ?? 0),
    };
  });

  return NextResponse.json({ products, location_id: locationId });
}
