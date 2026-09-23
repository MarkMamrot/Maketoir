import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';


// GET /api/ims/online-sales?location_id=X
// Returns list of days with SO summary, most recent first.
export async function GET(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;

  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('location_id');

  const params: any[] = [businessId];
  const locWhere = locationId ? 'AND so.location_id = ?' : '';
  if (locationId) params.push(Number(locationId));

  try {
    const rows = await imsQuery<{
      day: string;
      count: number;
      total: string;
      total_ex_tax: string;
      shopify_refunds: string;
      net_total: string;
      subtotal: string;
      tax: string;
      freight: string;
      discount: string;
      shopify_count: number;
      b2b_count: number;
      locations: string;
    }>(
      `SELECT
         DATE_FORMAT(so.order_date, '%Y-%m-%d') AS day,
         COUNT(*) AS count,
         SUM(so.total_amount) AS total,
         SUM(so.total_amount - so.tax_amount) AS total_ex_tax,
         SUM(so.subtotal) AS subtotal,
         SUM(so.tax_amount) AS tax,
         SUM(so.freight) AS freight,
         SUM(so.discount) AS discount,
         COUNT(CASE WHEN so.shopify_order_id IS NOT NULL THEN 1 END) AS shopify_count,
         COUNT(CASE WHEN so.cin7_order_id IS NOT NULL AND so.shopify_order_id IS NULL THEN 1 END) AS b2b_count,
         COUNT(CASE WHEN so.is_historical = 1 THEN 1 END) AS historical_count,
         COUNT(CASE WHEN (so.is_historical IS NULL OR so.is_historical = 0) AND so.status != 'cancelled' THEN 1 END) AS syncable_count,
         GROUP_CONCAT(DISTINCT l.name ORDER BY l.name SEPARATOR ', ') AS locations
       FROM ims_sales_orders so
       LEFT JOIN ims_locations l ON l.id = so.location_id
       WHERE so.so_type = 'online' AND so.business_id = ? ${locWhere}
       GROUP BY DATE_FORMAT(so.order_date, '%Y-%m-%d')
       ORDER BY day DESC`,
      params,
    );

    const refundParams: any[] = [businessId];
    const refundLocWhere = locationId ? 'AND cn.location_id = ?' : '';
    if (locationId) refundParams.push(Number(locationId));
    const refundRows = await imsQuery<{ day: string; total: string }>(
      `SELECT DATE_FORMAT(cn.cn_date, '%Y-%m-%d') AS day,
              SUM(CASE
                WHEN items.cn_id IS NULL THEN cn.total_amount
                WHEN cn.tax_treatment = 'inc_tax' THEN items.line_total
                WHEN cn.tax_treatment = 'no_tax' THEN items.line_total
                ELSE items.line_total + items.tax_amount
              END) AS total
         FROM ims_credit_notes cn
         LEFT JOIN (
           SELECT cn_id, SUM(line_total) AS line_total,
                  SUM(ROUND(line_total * tax_rate, 2)) AS tax_amount
             FROM ims_credit_note_items
            GROUP BY cn_id
         ) items ON items.cn_id = cn.id
        WHERE cn.business_id = ? AND cn.source = 'shopify' AND cn.status = 'complete' ${refundLocWhere}
        GROUP BY DATE_FORMAT(cn.cn_date, '%Y-%m-%d')`,
      refundParams,
    );
    const refundsByDay = new Map(refundRows.map(row => [String(row.day).slice(0, 10), Number(row.total)]));
    for (const row of rows as any[]) {
      const refundTotal = refundsByDay.get(String(row.day).slice(0, 10)) ?? 0;
      row.shopify_refunds = refundTotal;
      row.net_total = Number(row.total) - refundTotal;
    }

    // Load Xero sync status for these dates from the main DB.
    // xero_sync_log.detail = 'online batch YYYY-MM-DD' for online_batch entries.
    const xeroSyncMap: Record<string, 'ok' | 'err'> = {};
    if (rows.length > 0) {
      const dates = rows.map((r: any) => String(r.day).slice(0, 10));
      const detailKeys = dates.map((d: string) => `online batch ${d}`);
      const syncRows = await query<{ batch_key: string; status: string }>(
        `SELECT detail AS batch_key, status
         FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch'
           AND detail IN (${detailKeys.map(() => '?').join(',')})
           AND id IN (
             SELECT MAX(id) FROM xero_sync_log
             WHERE business_id = ? AND sync_type = 'online_batch'
             GROUP BY detail
           )`,
        [businessId, ...detailKeys, businessId],
      ).catch(() => []);
      for (const r of syncRows) {
        // Strip the 'online batch ' prefix to get the date key
        const dateKey = String(r.batch_key).replace('online batch ', '').slice(0, 10);
        xeroSyncMap[dateKey] = r.status === 'success' ? 'ok' : 'err';
      }
    }

    return NextResponse.json({ success: true, days: rows, xeroSyncStatus: xeroSyncMap });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
