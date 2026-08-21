import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const rows = await imsQuery<{ brand: string }>(
      `SELECT DISTINCT TRIM(p.brand) AS brand
         FROM ims_products p
        WHERE p.business_id = ? AND p.is_active = 1
          AND p.brand IS NOT NULL AND TRIM(p.brand) <> ''
          AND EXISTS (
            SELECT 1 FROM ims_product_variants v
             WHERE v.product_id = p.product_id AND v.is_active = 1 AND v.price_wholesale > 0
          )
        ORDER BY brand`,
      [session.businessId],
    );
    return NextResponse.json({ success: true, data: rows.map(row => row.brand) });
  } catch (error: any) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'WholesaleBrandsRoute',
      operation: 'list_wholesale_brands',
      title: 'Wholesale brand options could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}