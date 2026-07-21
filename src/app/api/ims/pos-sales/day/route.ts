import { NextRequest, NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// GET /api/ims/pos-sales/day?date=YYYY-MM-DD&location_id=X
// Returns all sales (with items) for a given day.
export async function GET(req: NextRequest) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date       = searchParams.get('date');
  const locationId = searchParams.get('location_id');
  const registerId = searchParams.get('register_id');

  if (!date) return NextResponse.json({ success: false, error: 'date is required' }, { status: 400 });

  const params: any[] = [date];
  let where = '';
  if (locationId) { where += ' AND p.location_id = ?'; params.push(Number(locationId)); }
  if (registerId) { where += ' AND p.register_id = ?'; params.push(Number(registerId)); }

  try {
    const sales = await imsQuery<any>(
      `SELECT p.*, l.name AS location_name, r.name AS register_name
       FROM pos_sales p
       LEFT JOIN ims_locations l ON l.id = p.location_id
       LEFT JOIN pos_registers r ON r.id = p.register_id
       WHERE DATE(p.completed_at) = ?
       ${where}
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

    const payments = await imsQuery<any>(
      `SELECT sale_id, payment_method, amount, reference FROM pos_payments WHERE sale_id IN (${saleIds.map(() => '?').join(',')}) ORDER BY id`,
      saleIds,
    );
    const paysBySale = new Map<number, any[]>();
    for (const pay of payments) {
      if (!paysBySale.has(pay.sale_id)) paysBySale.set(pay.sale_id, []);
      paysBySale.get(pay.sale_id)!.push(pay);
    }

    const result = sales.map((s: any) => ({ ...s, items: itemsBySale.get(s.id) ?? [], payments: paysBySale.get(s.id) ?? [] }));
    return NextResponse.json({ success: true, sales: result });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
