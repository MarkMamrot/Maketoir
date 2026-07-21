import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';


// GET /api/ims/product-types — returns all distinct product_type values from ims_products
export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const rows = await imsQuery<{ product_type: string }>(
      `SELECT DISTINCT product_type
       FROM ims_products
       WHERE product_type IS NOT NULL AND product_type != '' AND is_active = 1
       ORDER BY product_type`,
    );
    return NextResponse.json({ success: true, data: rows.map(r => r.product_type) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
