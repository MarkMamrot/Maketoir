import { NextRequest, NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// GET /api/ims/pos-sales?location_id=X&group_by_register=1
// Without group_by_register: returns { days } grouped by date (all-branches view).
// With group_by_register=1 + location_id: returns { registers } each with nested days + session info.
export async function GET(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locationId       = searchParams.get('location_id');
  const groupByRegister  = searchParams.get('group_by_register') === '1' && !!locationId;

  try {
    if (groupByRegister) {
      // ── Register-grouped view ────────────────────────────────────────────
      const locId = Number(locationId);

      // 1. Summary rows per register per day
      const summaryRows = await imsQuery<any>(
        `SELECT
           COALESCE(pr.id, 0)    AS register_id,
           COALESCE(pr.name, 'Unknown Register') AS register_name,
           DATE_FORMAT(ps.completed_at, '%Y-%m-%d') AS day,
           COUNT(*)                               AS count,
           SUM(ps.total)                          AS total,
           SUM(ps.subtotal)                       AS subtotal,
           SUM(ps.tax_total)                      AS tax,
           SUM(ps.discount_total)                 AS discount,
           SUM(CASE WHEN ps.sale_type = 'return' THEN 1 ELSE 0 END) AS returns
         FROM pos_sales ps
         LEFT JOIN pos_registers pr ON pr.id = ps.register_id
         WHERE ps.location_id = ? AND ps.status NOT IN ('parked')
         GROUP BY COALESCE(pr.id, 0), COALESCE(pr.name, 'Unknown Register'),
                  DATE_FORMAT(ps.completed_at, '%Y-%m-%d')
         ORDER BY COALESCE(pr.name, 'Unknown Register'), day DESC`,
        [locId],
      );

      // 2. Payment method breakdown per register per day
      const payRows = await imsQuery<any>(
        `SELECT
           COALESCE(ps.register_id, 0) AS register_id,
           DATE_FORMAT(ps.completed_at, '%Y-%m-%d') AS day,
           pp.payment_method,
           SUM(pp.amount) AS total
         FROM pos_payments pp
         JOIN pos_sales ps ON ps.id = pp.sale_id
         WHERE ps.location_id = ?
         GROUP BY COALESCE(ps.register_id, 0),
                  DATE_FORMAT(ps.completed_at, '%Y-%m-%d'),
                  pp.payment_method`,
        [locId],
      );

      // 3. Register sessions for this location
      const sessionRows = await imsQuery<any>(
        `SELECT prs.id, prs.register_id, prs.session_date,
                prs.opened_at, prs.closed_at, prs.opening_float, prs.status
         FROM pos_register_sessions prs
         JOIN pos_registers pr ON pr.id = prs.register_id
         WHERE pr.location_id = ?
         ORDER BY prs.session_date DESC`,
        [locId],
      );

      // Index payments: [register_id][day][method]
      const payIdx: Record<number, Record<string, Record<string, number>>> = {};
      for (const r of payRows) {
        const rid = Number(r.register_id);
        const d   = String(r.day).slice(0, 10);
        if (!payIdx[rid])     payIdx[rid]     = {};
        if (!payIdx[rid][d])  payIdx[rid][d]  = {};
        payIdx[rid][d][r.payment_method] = Number(r.total);
      }

      // Index sessions: [register_id][session_date]
      const sessIdx: Record<number, Record<string, any>> = {};
      for (const s of sessionRows) {
        const rid = Number(s.register_id);
        const d   = String(s.session_date).slice(0, 10);
        if (!sessIdx[rid]) sessIdx[rid] = {};
        sessIdx[rid][d] = s;
      }

      // Build register map
      const regMap = new Map<number, { register_id: number; register_name: string; total: number; count: number; days: any[] }>();
      for (const r of summaryRows) {
        const rid = Number(r.register_id);
        const d   = String(r.day).slice(0, 10);
        if (!regMap.has(rid)) {
          regMap.set(rid, { register_id: rid, register_name: r.register_name, total: 0, count: 0, days: [] });
        }
        const reg = regMap.get(rid)!;
        reg.total += Number(r.total);
        reg.count += Number(r.count);
        reg.days.push({
          day:      d,
          count:    Number(r.count),
          total:    Number(r.total),
          subtotal: Number(r.subtotal),
          tax:      Number(r.tax),
          discount: Number(r.discount),
          returns:  Number(r.returns),
          payments: payIdx[rid]?.[d] ?? {},
          session:  sessIdx[rid]?.[d] ?? null,
        });
      }

      return NextResponse.json({ success: true, registers: Array.from(regMap.values()) });
    }

    // ── Day-grouped view (original) ──────────────────────────────────────
    const params: any[] = [];
    const locWhere = locationId ? 'WHERE p.location_id = ?' : "WHERE p.status NOT IN ('parked')";
    if (locationId) params.push(Number(locationId));

    const rows = await imsQuery<{
      day: string; count: number; total: string; subtotal: string;
      tax: string; discount: string; returns: number; locations: string;
    }>(
      `SELECT
         DATE_FORMAT(p.completed_at, '%Y-%m-%d') AS day,
         COUNT(*) AS count,
         SUM(p.total) AS total,
         SUM(p.subtotal) AS subtotal,
         SUM(p.tax_total) AS tax,
         SUM(p.discount_total) AS discount,
         SUM(CASE WHEN p.sale_type = 'return' THEN 1 ELSE 0 END) AS returns,
         GROUP_CONCAT(DISTINCT l.name ORDER BY l.name SEPARATOR ', ') AS locations
       FROM pos_sales p
       LEFT JOIN ims_locations l ON l.id = p.location_id
       ${locWhere}
       GROUP BY DATE_FORMAT(p.completed_at, '%Y-%m-%d')
       ORDER BY day DESC`,
      params,
    );

    const payParams: any[] = [];
    if (locationId) payParams.push(Number(locationId));
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

