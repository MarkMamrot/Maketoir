import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET(req: Request) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const brand       = searchParams.get('brand')       ?? '';
  const supplierId  = searchParams.get('supplierId')  ?? '';
  const productType = searchParams.get('productType') ?? '';
  const productId   = searchParams.get('productId')   ?? '';

  const conds: string[] = ['v.is_active = 1', 'p.is_active = 1'];
  const filterParams: any[] = [];
  if (productId)   { conds.push('v.variant_id = ?');           filterParams.push(productId); }
  if (brand)       { conds.push('p.brand = ?');                filterParams.push(brand); }
  if (supplierId)  { conds.push('p.supplier_contact_id = ?');  filterParams.push(Number(supplierId)); }
  if (productType) { conds.push('p.product_type = ?');         filterParams.push(productType); }
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
        v.cost_aud AS cost,
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


