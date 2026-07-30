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

type BrandRow = {
  name: string;
  sales: number;
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
    const tax = total - revenueEx;
    return {
      channel: row.channel,
      location_name: row.location_name,
      total,
      tax,
      cogs: Number(cogs),
      gross_profit: total - tax - Number(cogs),
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

export function normaliseDashboardBrandRows<T extends { sales?: unknown }>(rows: T[]): Array<Omit<T, 'sales'> & { sales: number }> {
  return rows.map(row => ({ ...row, sales: Number(row.sales ?? 0) }));
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

export function dashboardSalesBounds(days: number, timeZone: string, yesterday: boolean, now = new Date()): { from: string; to: string | null } {
  if (!yesterday) return { from: businessCutoff(days, timeZone), to: null };
  const today = now.toLocaleDateString('sv-SE', { timeZone });
  const [year, month, day] = today.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  return { from: `${previous} 00:00:00`, to: `${today} 00:00:00` };
}

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '1', 10)));
  const yesterday = searchParams.get('window') === 'yesterday';
  const biz = session.businessId as string;
  const timeZone = await getBusinessTimeZone(biz);
  const { from: cutoff, to: upperBound } = dashboardSalesBounds(days, timeZone, yesterday);
  const posUpperClause = upperBound ? 'AND ps.created_at < ?' : '';
  const soUpperClause = upperBound ? 'AND so.order_date < ?' : '';
  const posDateParams = upperBound ? [cutoff, upperBound] : [cutoff];
  const soDateParams = upperBound ? [cutoff, upperBound] : [cutoff];
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
       ${posUpperClause}
     GROUP BY l.id, l.name`,
    biz ? [biz, ...posDateParams] : posDateParams
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
         ${soUpperClause}
         AND (so.is_historical IS NULL OR so.is_historical = 0)
         AND so.status != 'cancelled'
         ${soBizClause}
       GROUP BY l.id, l.name`,
      biz ? [...soDateParams, biz] : soDateParams
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
         ${soUpperClause}
         ${soBizClause}
       GROUP BY l.id, l.name`,
      biz ? [...soDateParams, biz] : soDateParams
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

  // COGS by channel/location, using the same line-item cost basis as IMS transaction cards.
  // If this query fails, keep showing revenue rows so dashboard doesn't go blank.
  try {
    const [posCogsRows, onlineCogsRows, wholesaleCogsRows] = await Promise.all([
      imsQuery<CogsRow>(
        `SELECT 'pos' AS channel,
                COALESCE(l.name, 'Unknown') AS location_name,
                SUM(COALESCE(psi.qty, 0) * COALESCE(pv.avg_cost, pv.cost_aud, 0)) AS cogs
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
         JOIN pos_sale_items psi ON psi.sale_id = ps.id
         LEFT JOIN ims_product_variants pv ON pv.variant_id = psi.variant_id
         WHERE ps.status = 'completed'
           AND ps.created_at >= ?
           ${posUpperClause}
         GROUP BY l.id, l.name`,
        [biz, ...posDateParams],
      ),
      imsQuery<CogsRow>(
        `SELECT 'online' AS channel,
                COALESCE(l.name, 'Unknown') AS location_name,
                SUM(ABS(COALESCE(soi.qty_ordered, 0)) * COALESCE(soi.unit_cost, pv.avg_cost, pv.cost_aud, 0)) AS cogs
         FROM ims_sales_orders so
         LEFT JOIN ims_locations l ON l.id = so.location_id
         JOIN ims_sales_order_items soi ON soi.so_id = so.id
         LEFT JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
         WHERE so.so_type = 'online'
           AND so.order_date >= ?
           ${soUpperClause}
           AND (so.is_historical IS NULL OR so.is_historical = 0)
           AND so.status != 'cancelled'
           ${soBizClause}
         GROUP BY l.id, l.name`,
        biz ? [...soDateParams, biz] : soDateParams,
      ),
      imsQuery<CogsRow>(
        `SELECT 'wholesale' AS channel,
                COALESCE(l.name, 'Unknown') AS location_name,
                SUM(ABS(COALESCE(soi.qty_ordered, 0)) * COALESCE(soi.unit_cost, pv.avg_cost, pv.cost_aud, 0)) AS cogs
         FROM ims_sales_orders so
         LEFT JOIN ims_locations l ON l.id = so.location_id
         JOIN ims_sales_order_items soi ON soi.so_id = so.id
         LEFT JOIN ims_product_variants pv ON pv.variant_id = soi.variant_id
         WHERE so.so_type != 'online'
           AND so.status = 'fulfilled'
           AND so.order_date >= ?
           ${soUpperClause}
           ${soBizClause}
         GROUP BY l.id, l.name`,
        biz ? [...soDateParams, biz] : soDateParams,
      ),
    ]);

    const cogsRows = [...posCogsRows, ...onlineCogsRows, ...wholesaleCogsRows];

    channelRows = buildChannelRowsWithGrossProfit(revenueRows, cogsRows);
  } catch (error) {
    console.error('[dashboard/sales] COGS aggregation failed; falling back to ex-tax revenue for GP bars.', error);
  }

  let brandRows: BrandRow[] = [];
  try {
    brandRows = await imsQuery<BrandRow>(
      `SELECT COALESCE(NULLIF(TRIM(p.brand), ''), 'Unbranded') AS name, SUM(sales_lines.sales) AS sales
       FROM (
         SELECT COALESCE(pvid.variant_id, psku.variant_id) AS variant_id, COALESCE(psi.line_total, 0) AS sales
         FROM pos_sales ps
         JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
         JOIN pos_sale_items psi ON psi.sale_id = ps.id
         LEFT JOIN ims_product_variants pvid ON pvid.variant_id = psi.variant_id
         LEFT JOIN ims_product_variants psku ON pvid.variant_id IS NULL AND psku.sku = psi.code
         WHERE ps.status = 'completed'
           AND ps.created_at >= ?
           ${posUpperClause}

         UNION ALL

         SELECT COALESCE(svid.variant_id, ssku.variant_id) AS variant_id, COALESCE(soi.line_total, 0) AS sales
         FROM ims_sales_orders so
         JOIN ims_sales_order_items soi ON soi.so_id = so.id
         LEFT JOIN ims_product_variants svid ON svid.variant_id = soi.variant_id
         LEFT JOIN ims_product_variants ssku ON svid.variant_id IS NULL AND ssku.sku = soi.code
         WHERE so.order_date >= ?
           ${soUpperClause}
           AND ((so.so_type = 'online' AND (so.is_historical IS NULL OR so.is_historical = 0) AND so.status != 'cancelled')
             OR (so.so_type != 'online' AND so.status = 'fulfilled'))
           ${soBizClause}
      ) sales_lines
      LEFT JOIN ims_product_variants pv ON pv.variant_id = sales_lines.variant_id
      LEFT JOIN ims_products p ON p.product_id = pv.product_id
       GROUP BY COALESCE(NULLIF(TRIM(p.brand), ''), 'Unbranded')
       ORDER BY sales DESC
       LIMIT 10`,
      [biz, ...posDateParams, ...soDateParams, ...(biz ? [biz] : [])],
    );
  } catch (error) {
    console.error('[dashboard/sales] Brand aggregation failed.', error);
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
    brandData: normaliseDashboardBrandRows(brandRows),
    recentPOS,
  });
}
