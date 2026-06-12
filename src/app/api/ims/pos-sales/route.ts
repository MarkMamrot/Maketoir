import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/pos-sales?location_id=X
// Returns list of days with sale summary, most recent first.
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('location_id');

  const params: any[] = [];
  const locWhere = locationId ? 'WHERE p.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const rows = await imsQuery<{
      day: string;
      count: number;
      total: string;
      returns: number;
      locations: string;
    }>(
      `SELECT
         DATE_FORMAT(p.completed_at, '%Y-%m-%d') AS day,
         COUNT(*) AS count,
         SUM(p.total) AS total,
         SUM(CASE WHEN p.sale_type = 'return' THEN 1 ELSE 0 END) AS returns,
         GROUP_CONCAT(DISTINCT l.name ORDER BY l.name SEPARATOR ', ') AS locations
       FROM pos_sales p
       LEFT JOIN ims_locations l ON l.id = p.location_id
       ${locWhere}
       GROUP BY DATE_FORMAT(p.completed_at, '%Y-%m-%d')
       ORDER BY day DESC`,
      params,
    );

    // Payment method totals by day (from live POS transactions; Cin7 historical imports have no payment data)
    const payParams: any[] = locationId ? [Number(locationId)] : [];
    const payRows = await imsQuery<{ day: string; payment_method: string; total: string }>(
      `SELECT DATE_FORMAT(ps.completed_at, '%Y-%m-%d') AS day,
              pp.payment_method,
              SUM(pp.amount) AS total
       FROM pos_payments pp
       JOIN pos_sales ps ON ps.id = pp.sale_id
       ${locationId ? 'WHERE ps.location_id = ?' : ''}
       GROUP BY DATE_FORMAT(ps.completed_at, '%Y-%m-%d'), pp.payment_method`,
      payParams,
    );

    const payByDay: Record<string, Record<string, number>> = {};
    for (const r of payRows) {
      const d = String(r.day).slice(0, 10);
      if (!payByDay[d]) payByDay[d] = {};
      payByDay[d][r.payment_method] = Number(r.total);
    }

    const days = rows.map(r => ({ ...r, payments: payByDay[String(r.day).slice(0, 10)] ?? {} }));
    return NextResponse.json({ success: true, days });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
