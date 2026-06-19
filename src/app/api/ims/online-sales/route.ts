import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/online-sales?location_id=X
// Returns list of days with SO summary, most recent first.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('location_id');

  const params: any[] = [];
  const locWhere = locationId ? 'AND so.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const rows = await imsQuery<{
      day: string;
      count: number;
      total: string;
      subtotal: string;
      tax: string;
      freight: string;
      discount: string;
      shopify_count: number;
      b2b_count: number;
      locations: string;
    }>(
      `SELECT
         DATE_FORMAT(so.order_date, '%Y-%m-%d') AS day,
         COUNT(*) AS count,
         SUM(so.total_amount) AS total,
         SUM(so.subtotal) AS subtotal,
         SUM(so.tax_amount) AS tax,
         SUM(so.freight) AS freight,
         SUM(so.discount) AS discount,
         COUNT(CASE WHEN so.shopify_order_id IS NOT NULL THEN 1 END) AS shopify_count,
         COUNT(CASE WHEN so.cin7_order_id IS NOT NULL AND so.shopify_order_id IS NULL THEN 1 END) AS b2b_count,
         GROUP_CONCAT(DISTINCT l.name ORDER BY l.name SEPARATOR ', ') AS locations
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type = 'online' ${locWhere}
       GROUP BY DATE_FORMAT(so.order_date, '%Y-%m-%d')
       ORDER BY day DESC`,
      params,
    );

    return NextResponse.json({ success: true, days: rows });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
