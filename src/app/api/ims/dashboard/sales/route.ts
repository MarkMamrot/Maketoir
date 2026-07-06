import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// Compute the start-of-period cutoff as an AEST datetime string.
// pos_sales.created_at stores AEST datetimes (no TZ info).
// days=1 → start of today AEST; days=30 → start of 30 days ago AEST, etc.
function aestCutoff(days: number): string {
  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  const offsetMs = (days - 1) * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - offsetMs);
  const dateStr = cutoffDate.toLocaleDateString('sv-SE', { timeZone: tz }); // YYYY-MM-DD
  return `${dateStr} 00:00:00`;
}

export async function GET(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '1', 10)));
  const biz = session.businessId as string;
  const cutoff = aestCutoff(days);
  const soBizClause = biz ? 'AND so.business_id = ?' : '';

  // POS channel — scope by ims_locations.business_id (pos_sales.business_id is not reliably set)
  const posRows = await imsQuery<{ channel: string; location_name: string; total: number; order_count: number }>(
    `SELECT 'pos' AS channel, l.name AS location_name,
            SUM(ps.total) AS total, COUNT(*) AS order_count
     FROM pos_sales ps
     JOIN ims_locations l ON l.id = ps.location_id${biz ? ' AND l.business_id = ?' : ''}
     WHERE ps.status = 'completed'
       AND ps.created_at >= ?
     GROUP BY l.id, l.name`,
    biz ? [biz, cutoff] : [cutoff]
  );

  // SO channel — fulfilled SOs, channel derived from so_type.
  // Bucket by order_date (actual order date, e.g. Shopify) — NOT created_at (DB insert time),
  // so late-synced orders still count on the day the order was placed.
  const soRows = await imsQuery<{ channel: string; location_name: string; total: number; order_count: number }>(
    `SELECT CASE WHEN so.so_type = 'online' THEN 'online' ELSE 'wholesale' END AS channel,
            COALESCE(l.name, 'Unknown') AS location_name,
            SUM(so.total_amount) AS total, COUNT(*) AS order_count
     FROM ims_sales_orders so
     LEFT JOIN ims_locations l ON l.id = so.location_id
     WHERE so.status = 'fulfilled'
       AND so.order_date >= ?
       ${soBizClause}
     GROUP BY channel, l.id, l.name`,
    biz ? [cutoff, biz] : [cutoff]
  );

  // Recent POS sales (last 20, regardless of period filter)
  const recentPOS = await imsQuery<any>(
    `SELECT ps.id, ps.created_at, ps.total, ps.cashier_name, ps.customer_name,
            ps.sale_type, ps.status, COALESCE(l.name, 'Unknown') AS location_name
     FROM pos_sales ps
     JOIN ims_locations l ON l.id = ps.location_id${biz ? ' AND l.business_id = ?' : ''}
     WHERE ps.status = 'completed'
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
