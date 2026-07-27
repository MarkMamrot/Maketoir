import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';

export function normaliseDashboardSalesRows<T extends { total?: unknown; gross_profit?: unknown; order_count?: unknown }>(rows: T[]): Array<Omit<T, 'total' | 'gross_profit' | 'order_count'> & { total: number; gross_profit: number; order_count: number }> {
  return rows.map(row => ({
    ...row,
    total: Number(row.total ?? 0),
    gross_profit: Number(row.gross_profit ?? 0),
    order_count: Number(row.order_count ?? 0),
  }));
}

// Compute the start-of-period cutoff as an AEST datetime string.
// pos_sales.created_at stores AEST datetimes (no TZ info).
// days=1 → start of today AEST; days=30 → start of 30 days ago AEST, etc.
function businessCutoff(days: number, timeZone: string): string {
  const offsetMs = (days - 1) * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - offsetMs);
  const dateStr = cutoffDate.toLocaleDateString('sv-SE', { timeZone }); // YYYY-MM-DD
  return `${dateStr} 00:00:00`;
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '1', 10)));
  const biz = session.businessId as string;
  const timeZone = await getBusinessTimeZone(biz);
  const cutoff = businessCutoff(days, timeZone);
  const soBizClause = biz ? 'AND so.business_id = ?' : '';

  // POS channel — scope by ims_locations.business_id (pos_sales.business_id is not reliably set)
  const posRows = await imsQuery<{ channel: string; location_name: string; total: number; gross_profit: number; order_count: number }>(
    `SELECT 'pos' AS channel, l.name AS location_name,
            SUM(ps.total) AS total,
            SUM(COALESCE(ps.total, 0) - COALESCE(ps.tax_total, 0)) AS gross_profit,
            COUNT(*) AS order_count
     FROM pos_sales ps
     JOIN ims_locations l ON l.id = ps.location_id${biz ? ' AND l.business_id = ?' : ''}
     WHERE ps.status = 'completed'
       AND ps.created_at >= ?
     GROUP BY l.id, l.name`,
    biz ? [biz, cutoff] : [cutoff]
  );

  // SO channel split logic:
  // - Online must mirror Online Sales / daily batch detection:
  //   so_type='online', non-historical only, status != cancelled.
  // - Wholesale remains fulfilled-only revenue.
  // Both use order_date (wall-clock business date), not created_at.
  const [onlineRows, wholesaleRows] = await Promise.all([
    imsQuery<{ channel: string; location_name: string; total: number; gross_profit: number; order_count: number }>(
      `SELECT 'online' AS channel,
              COALESCE(l.name, 'Unknown') AS location_name,
              SUM(so.total_amount) AS total,
              SUM(COALESCE(so.total_amount, 0) - COALESCE(so.tax_amount, 0)) AS gross_profit,
              COUNT(*) AS order_count
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type = 'online'
         AND so.order_date >= ?
         AND (so.is_historical IS NULL OR so.is_historical = 0)
         AND so.status != 'cancelled'
         ${soBizClause}
       GROUP BY l.id, l.name`,
      biz ? [cutoff, biz] : [cutoff]
    ),
    imsQuery<{ channel: string; location_name: string; total: number; gross_profit: number; order_count: number }>(
      `SELECT 'wholesale' AS channel,
              COALESCE(l.name, 'Unknown') AS location_name,
              SUM(so.total_amount) AS total,
              SUM(COALESCE(so.total_amount, 0) - COALESCE(so.tax_amount, 0)) AS gross_profit,
              COUNT(*) AS order_count
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type != 'online'
         AND so.status = 'fulfilled'
         AND so.order_date >= ?
         ${soBizClause}
       GROUP BY l.id, l.name`,
      biz ? [cutoff, biz] : [cutoff]
    ),
  ]);

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
    channelData: normaliseDashboardSalesRows([...posRows, ...onlineRows, ...wholesaleRows]),
    recentPOS,
  });
}
