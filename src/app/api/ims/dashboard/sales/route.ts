import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '1', 10)));
  const biz = session.businessId as string;
  const p = (extra: any[]) => biz ? [days, biz, ...extra] : [days, ...extra];
  const bizClause = biz ? 'AND ps.business_id = ?' : '';
  const soBizClause = biz ? 'AND so.business_id = ?' : '';

  // POS channel — completed sales only (returns have negative totals, include them)
  const posRows = await imsQuery<{ channel: string; location_name: string; total: number; order_count: number }>(
    `SELECT 'pos' AS channel, COALESCE(l.name, 'Unknown') AS location_name,
            SUM(ps.total) AS total, COUNT(*) AS order_count
     FROM pos_sales ps
     LEFT JOIN ims_locations l ON l.id = ps.location_id
     WHERE ps.status = 'completed'
       AND ps.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ${bizClause}
     GROUP BY l.id, l.name`,
    biz ? [days, biz] : [days]
  );

  // SO channel — fulfilled SOs, channel derived from so_type
  const soRows = await imsQuery<{ channel: string; location_name: string; total: number; order_count: number }>(
    `SELECT CASE WHEN so.so_type = 'online' THEN 'online' ELSE 'wholesale' END AS channel,
            COALESCE(l.name, 'Unknown') AS location_name,
            SUM(so.total_amount) AS total, COUNT(*) AS order_count
     FROM ims_sales_orders so
     LEFT JOIN ims_locations l ON l.id = so.location_id
     WHERE so.status = 'fulfilled'
       AND so.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ${soBizClause}
     GROUP BY channel, l.id, l.name`,
    biz ? [days, biz] : [days]
  );

  // Recent POS sales (last 20, regardless of period filter)
  const recentPOS = await imsQuery<any>(
    `SELECT ps.id, ps.created_at, ps.total, ps.cashier_name, ps.customer_name,
            ps.sale_type, ps.status, COALESCE(l.name, 'Unknown') AS location_name
     FROM pos_sales ps
     LEFT JOIN ims_locations l ON l.id = ps.location_id
     WHERE ps.status = 'completed'
       ${biz ? 'AND ps.business_id = ?' : ''}
     ORDER BY ps.created_at DESC
     LIMIT 20`,
    biz ? [biz] : []
  );

  return NextResponse.json({
    success: true,
    channelData: [...posRows, ...soRows],
    recentPOS,
  });
}
