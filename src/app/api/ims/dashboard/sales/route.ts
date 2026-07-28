import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';

type ChannelName = 'pos' | 'online' | 'wholesale';

type RevenueRow = {
  channel: ChannelName;
  location_name: string;
  total: number;
  revenue_ex: number;
  order_count: number;
};

type CogsRow = {
  channel: ChannelName;
  location_name: string;
  cogs: number;
};

type ChannelRow = {
  channel: ChannelName;
  location_name: string;
  total: number;
  tax: number;
  cogs: number;
  gross_profit: number;
  order_count: number;
};

function keyByChannelLocation(channel: string, locationName: string): string {
  return `${channel}::${locationName}`;
}

function buildChannelRowsWithGrossProfit(revenueRows: RevenueRow[], cogsRows: CogsRow[]): ChannelRow[] {
  const cogsByKey = new Map<string, number>();
  for (const row of cogsRows) {
    cogsByKey.set(keyByChannelLocation(row.channel, row.location_name), Number(row.cogs ?? 0));
  }

  return revenueRows.map(row => {
    const cogs = cogsByKey.get(keyByChannelLocation(row.channel, row.location_name)) ?? 0;
    const total = Number(row.total ?? 0);
    const revenueEx = Number(row.revenue_ex ?? 0);
    return {
      channel: row.channel,
      location_name: row.location_name,
      total,
      tax: total - revenueEx,
      cogs: Number(cogs),
      gross_profit: revenueEx - Number(cogs),
      order_count: Number(row.order_count ?? 0),
    };
  });
}

export function normaliseDashboardSalesRows<T extends { total?: unknown; tax?: unknown; cogs?: unknown; gross_profit?: unknown; order_count?: unknown }>(rows: T[]): Array<Omit<T, 'total' | 'tax' | 'cogs' | 'gross_profit' | 'order_count'> & { total: number; tax: number; cogs: number; gross_profit: number; order_count: number }> {
  return rows.map(row => ({
    ...row,
    total: Number(row.total ?? 0),
    tax: Number(row.tax ?? 0),
    cogs: Number(row.cogs ?? 0),
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
  const posRows = await imsQuery<RevenueRow>(
    `SELECT 'pos' AS channel, l.name AS location_name,
            SUM(ps.total) AS total,
            SUM(COALESCE(ps.total, 0) - COALESCE(ps.tax_total, 0)) AS revenue_ex,
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
    imsQuery<RevenueRow>(
      `SELECT 'online' AS channel,
              COALESCE(l.name, 'Unknown') AS location_name,
              SUM(so.total_amount) AS total,
              SUM(COALESCE(so.total_amount, 0) - COALESCE(so.tax_amount, 0)) AS revenue_ex,
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
    imsQuery<RevenueRow>(
      `SELECT 'wholesale' AS channel,
              COALESCE(l.name, 'Unknown') AS location_name,
              SUM(so.total_amount) AS total,
              SUM(COALESCE(so.total_amount, 0) - COALESCE(so.tax_amount, 0)) AS revenue_ex,
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

  const revenueRows = [...posRows, ...onlineRows, ...wholesaleRows];
  let channelRows: ChannelRow[] = revenueRows.map(row => {
    const total = Number(row.total ?? 0);
    const revenueEx = Number(row.revenue_ex ?? 0);
    return {
      channel: row.channel,
      location_name: row.location_name,
      total,
      tax: total - revenueEx,
      cogs: 0,
      gross_profit: revenueEx,
      order_count: Number(row.order_count ?? 0),
    };
  });

  // COGS by channel/location from stock movements, aligned with dashboard period filters.
  // If this query fails, keep showing revenue rows so dashboard doesn't go blank.
  try {
    const cogsRows = await imsQuery<CogsRow>(
      `SELECT base.channel,
              base.location_name,
              SUM(base.cogs) AS cogs
         FROM (
           SELECT CASE
                    WHEN sm.movement_type = 'pos_sale' THEN 'pos'
                    WHEN so.so_type = 'online' THEN 'online'
                    ELSE 'wholesale'
                  END AS channel,
                  COALESCE(l.name, 'Unknown') AS location_name,
                  CASE
                    WHEN sm.unit_cost IS NULL OR sm.unit_cost <= 0 THEN 0
                    ELSE -sm.qty_change * sm.unit_cost
                  END AS cogs
             FROM ims_stock_movements sm
             JOIN ims_locations l
               ON l.id = sm.location_id
              AND l.business_id = ?
             LEFT JOIN pos_sales ps
               ON sm.movement_type = 'pos_sale'
              AND sm.reference_type = 'pos_sale'
              AND ps.id = sm.reference_id
             LEFT JOIN ims_sales_orders so
               ON sm.movement_type = 'so_fulfilled'
              AND sm.reference_type = 'sales_order'
              AND so.id = sm.reference_id
            WHERE sm.movement_type IN ('pos_sale', 'so_fulfilled')
              AND (
                (
                  sm.movement_type = 'pos_sale'
                  AND ps.id IS NOT NULL
                  AND ps.status = 'completed'
                  AND ps.created_at >= ?
                )
                OR (
                  sm.movement_type = 'so_fulfilled'
                  AND so.id IS NOT NULL
                  AND so.so_type = 'online'
                  AND so.order_date >= ?
                  AND (so.is_historical IS NULL OR so.is_historical = 0)
                  AND so.status != 'cancelled'
                )
                OR (
                  sm.movement_type = 'so_fulfilled'
                  AND so.id IS NOT NULL
                  AND so.so_type != 'online'
                  AND so.status = 'fulfilled'
                  AND so.order_date >= ?
                )
              )
         ) base
        GROUP BY base.channel, base.location_name`,
      [biz, cutoff, cutoff, cutoff]
    );

    channelRows = buildChannelRowsWithGrossProfit(revenueRows, cogsRows);
  } catch (error) {
    console.error('[dashboard/sales] COGS aggregation failed; falling back to ex-tax revenue for GP bars.', error);
  }

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
    channelData: normaliseDashboardSalesRows(channelRows),
    recentPOS,
  });
}
