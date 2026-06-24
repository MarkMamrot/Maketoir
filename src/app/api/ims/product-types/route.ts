import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/product-types — returns all distinct product_type values from ims_products
export async function GET() {
  const session = getSession();
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
