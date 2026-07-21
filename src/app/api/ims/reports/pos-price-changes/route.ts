import { NextRequest, NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// GET /api/ims/reports/pos-price-changes?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns all POS sale items where unit_price differs from original_price (i.e. manual price overrides).
export async function GET(req: NextRequest) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = searchParams.get('to')   ?? new Date().toISOString().slice(0, 10);

  try {
    const data = await imsQuery<any>(
      `SELECT
         ps.id             AS sale_id,
         ps.completed_at,
         l.name            AS location_name,
         ps.cashier_name,
         pi.name           AS item_name,
         pi.code           AS item_code,
         pi.original_price,
         pi.unit_price
       FROM pos_sale_items pi
       JOIN pos_sales ps ON ps.id = pi.sale_id
       LEFT JOIN ims_locations l ON l.id = ps.location_id
       WHERE pi.original_price IS NOT NULL
         AND ROUND(pi.unit_price, 4) != ROUND(pi.original_price, 4)
         AND ps.status = 'completed'
         AND DATE(ps.completed_at) BETWEEN ? AND ?
       ORDER BY ps.completed_at DESC`,
      [from, to],
    );

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
