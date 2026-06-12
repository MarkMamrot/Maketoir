import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const filterType  = searchParams.get('filterType')  ?? '';
  const filterValue = searchParams.get('filterValue') ?? '';

  // Build filter clause
  const conds: string[] = ['v.is_active = 1', 'p.is_active = 1'];
  const filterParams: any[] = [];
  if (filterType === 'product' && filterValue) {
    conds.push('v.variant_id = ?');
    filterParams.push(filterValue);
  } else if (filterType === 'brand' && filterValue) {
    conds.push('p.brand = ?');
    filterParams.push(filterValue);
  } else if (filterType === 'supplier' && filterValue) {
    conds.push('p.supplier_contact_id = ?');
    filterParams.push(Number(filterValue));
  } else if (filterType === 'product_type' && filterValue) {
    conds.push('p.product_type = ?');
    filterParams.push(filterValue);
  }
  const where = 'WHERE ' + conds.join(' AND ');

  try {
    const rows = await imsQuery<{
      sku: string;
      name: string;
      brand: string;
      supplier_name: string;
      cost: number;
      soh: number;
    }>(`
      SELECT
        v.sku,
        p.name,
        p.brand,
        c.name as supplier_name,
        v.cost,
        SUM(s.qty_on_hand) as soh
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      LEFT JOIN ims_contacts c ON p.supplier_contact_id = c.id
      LEFT JOIN ims_stock s ON s.variant_id = v.variant_id
      ${where}
      GROUP BY v.variant_id
      HAVING soh > 0
      ORDER BY p.brand, p.name, v.sku
    `, filterParams);

    // Calculate total value computationally to avoid weird formatting in MySQL
    const data = rows.map(r => ({
      ...r,
      soh: Number(r.soh ?? 0),
      cost: Number(r.cost ?? 0),
      total_value: Number(r.soh ?? 0) * Number(r.cost ?? 0)
    }));

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
