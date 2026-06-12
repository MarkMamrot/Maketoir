import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/pos-sales/day?date=YYYY-MM-DD&location_id=X
// Returns all sales (with items) for a given day.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const locationId = searchParams.get('location_id');

  if (!date) return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });

  const params: any[] = [date];
  const locWhere = locationId ? 'AND p.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const sales = await imsQuery<any>(
      `SELECT p.*, l.name AS location_name
       FROM pos_sales p
       LEFT JOIN ims_locations l ON l.id = p.location_id
       WHERE DATE(p.completed_at) = ?
       ${locWhere}
       ORDER BY p.completed_at ASC`,
      params,
    );

    if (!sales.length) return NextResponse.json({ success: true, sales: [] });

    const saleIds = sales.map((s: any) => s.id);
    const items = await imsQuery<any>(
      `SELECT * FROM pos_sale_items WHERE sale_id IN (${saleIds.map(() => '?').join(',')}) ORDER BY id`,
      saleIds,
    );

    const itemsBySale = new Map<number, any[]>();
    for (const item of items) {
      if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
      itemsBySale.get(item.sale_id)!.push(item);
    }

    const result = sales.map((s: any) => ({ ...s, items: itemsBySale.get(s.id) ?? [] }));
    return NextResponse.json({ success: true, sales: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
