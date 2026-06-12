import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/online-sales/day?date=YYYY-MM-DD&location_id=X
// Returns all sales orders (with items) for a given day.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const locationId = searchParams.get('location_id');

  if (!date) return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });

  const params: any[] = [date];
  const locWhere = locationId ? 'AND so.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const orders = await imsQuery<any>(
      `SELECT so.*,
              c.name AS customer_name,
              l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type = 'online' AND DATE_FORMAT(so.order_date, '%Y-%m-%d') = ?
       ${locWhere}
       ORDER BY so.id ASC`,
      params,
    );

    if (!orders.length) return NextResponse.json({ success: true, orders: [] });

    const orderIds = orders.map((o: any) => o.id);
    const items = await imsQuery<any>(
      `SELECT i.*,
              COALESCE(p.name, i.name) AS product_name,
              v.sku
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.so_id IN (${orderIds.map(() => '?').join(',')})
       ORDER BY i.id`,
      orderIds,
    );

    const itemsByOrder = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsByOrder.has(item.so_id)) itemsByOrder.set(item.so_id, []);
      itemsByOrder.get(item.so_id)!.push(item);
    }

    const result = orders.map((o: any) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] }));
    return NextResponse.json({ success: true, orders: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
