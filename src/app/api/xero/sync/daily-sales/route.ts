/**
 * POST /api/xero/sync/daily-sales
 * Body: { databaseId, date, channel: 'pos' | 'online', locationId?: number }
 *
 * Posts a summary invoice for a day's POS or online sales.
 * Aggregates from ims_pos_sales / ims_online_sales tables.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncDailySalesBatch } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, date, channel, locationId } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!date || !channel) {
    return NextResponse.json({ error: 'date and channel are required.' }, { status: 400 });
  }
  if (!['pos', 'online'].includes(channel)) {
    return NextResponse.json({ error: 'channel must be "pos" or "online".' }, { status: 400 });
  }

  try {
    let totalSales = 0;
    let totalTax = 0;
    let lineDescription = '';

    if (channel === 'pos') {
      // Aggregate POS sales for the given date and location
      const rows = await query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_sales, COALESCE(SUM(tax_amount), 0) AS total_tax, COUNT(*) AS txn_count
         FROM ims_pos_sales
         WHERE business_id = ? AND DATE(sale_date) = ? ${locationId ? 'AND location_id = ?' : ''}`,
        locationId ? [databaseId, date, locationId] : [databaseId, date],
      );
      totalSales = Number(rows[0]?.total_sales || 0);
      totalTax = Number(rows[0]?.total_tax || 0);
      const count = Number(rows[0]?.txn_count || 0);

      // Get location name
      let locName = '';
      if (locationId) {
        const locRows = await query('SELECT name FROM ims_locations WHERE id = ?', [locationId]);
        locName = locRows[0]?.name || `Location ${locationId}`;
      }
      lineDescription = `POS Sales ${date}${locName ? ` — ${locName}` : ''} (${count} transactions)`;
    } else {
      // Aggregate online sales for the given date
      const rows = await query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_sales, COALESCE(SUM(tax_amount), 0) AS total_tax, COUNT(*) AS txn_count
         FROM ims_sales_orders
         WHERE business_id = ? AND DATE(order_date) = ? AND so_type = 'online'`,
        [databaseId, date],
      );
      totalSales = Number(rows[0]?.total_sales || 0);
      totalTax = Number(rows[0]?.total_tax || 0);
      const count = Number(rows[0]?.txn_count || 0);
      lineDescription = `Online Sales ${date} (${count} orders)`;
    }

    if (totalSales === 0) {
      return NextResponse.json({ success: false, message: 'No sales found for this date/channel.' });
    }

    const xeroId = await syncDailySalesBatch(databaseId, {
      date,
      locationId: locationId ?? undefined,
      channel,
      totalSales,
      totalTax,
      lineDescription,
    });

    return NextResponse.json({ success: !!xeroId, xeroId, totalSales, totalTax });
  } catch (err: any) {
    return NextResponse.json({ error: 'Daily sales sync failed.' }, { status: 500 });
  }
}
