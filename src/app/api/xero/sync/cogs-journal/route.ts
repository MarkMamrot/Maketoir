/**
 * POST /api/xero/sync/cogs-journal
 * Body: { databaseId, month: 'YYYY-MM' }
 *
 * Posts the monthly COGS journal: DR Cost of Goods Sold, CR Inventory Asset.
 * Calculates total from stock movements (fulfilled sales) for the month.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncMonthlyCOGSJournal } from '@/services/XeroSyncService';
import { query } from '@/services/MySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, month } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month is required (format: YYYY-MM).' }, { status: 400 });
  }

  try {
    // Calculate COGS from stock movements (sales/fulfillments) for the month.
    // movement_type = 'sale' or 'fulfillment', qty is negative (outgoing), cost_at_time is the avg cost at the time.
    const startDate = `${month}-01`;
    const endDate = `${month}-31`; // MySQL handles month boundaries

    const rows = await query(
      `SELECT COALESCE(SUM(ABS(sm.qty) * sm.cost_at_time), 0) AS total_cogs
       FROM ims_stock_movements sm
       WHERE sm.business_id = ?
         AND sm.movement_type IN ('sale', 'fulfillment', 'so_fulfil')
         AND sm.created_at >= ? AND sm.created_at < DATE_ADD(?, INTERVAL 1 MONTH)`,
      [databaseId, startDate, startDate],
    );

    const totalCOGS = Number(rows[0]?.total_cogs || 0);

    if (totalCOGS === 0) {
      return NextResponse.json({ success: false, message: 'No COGS calculated for this month (no fulfilled sales).' });
    }

    const journalId = await syncMonthlyCOGSJournal(databaseId, month, totalCOGS);
    return NextResponse.json({ success: !!journalId, xeroId: journalId, totalCOGS });
  } catch (err: any) {
    return NextResponse.json({ error: 'COGS journal sync failed.' }, { status: 500 });
  }
}
