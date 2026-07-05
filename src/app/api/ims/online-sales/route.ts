import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

// GET /api/ims/online-sales?location_id=X
// Returns list of days with SO summary, most recent first.
export async function GET(req: NextRequest) {
  const session = getSession();
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

    // Load Xero sync status for these dates from the main DB.
    // xero_sync_log.detail = 'YYYY-MM-DD' for online_batch entries.
    const xeroSyncMap: Record<string, 'ok' | 'err'> = {};
    if (rows.length > 0) {
      const dates = rows.map((r: any) => String(r.day).slice(0, 10));
      const syncRows = await query<{ batch_key: string; status: string }>(
        `SELECT detail AS batch_key, status
         FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch'
           AND detail IN (${dates.map(() => '?').join(',')})
           AND id IN (
             SELECT MAX(id) FROM xero_sync_log
             WHERE business_id = ? AND sync_type = 'online_batch'
             GROUP BY detail
           )`,
        [businessId, ...dates, businessId],
      ).catch(() => []);
      for (const r of syncRows) {
        xeroSyncMap[String(r.batch_key).slice(0, 10)] = r.status === 'success' ? 'ok' : 'err';
      }
    }

    return NextResponse.json({ success: true, days: rows, xeroSyncStatus: xeroSyncMap });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
