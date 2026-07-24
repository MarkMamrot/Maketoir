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
import { imsQuery } from '@/services/IMSMySQLService';

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
    // Calculate COGS from IMS stock movements for the month.
    // SO fulfils always consume stock; POS sales consume when qty_change < 0,
    // while positive qty_change rows are returns/reversals and reduce COGS.
    const startDate = `${month}-01`;

    const rows = await imsQuery<{ total_cogs: number }>(
      `SELECT COALESCE(SUM(
          CASE
            WHEN sm.movement_type = 'so_fulfilled'
              THEN ABS(sm.qty_change) * COALESCE(sm.unit_cost, 0)
            WHEN sm.movement_type = 'pos_sale'
              THEN CASE
                     WHEN sm.qty_change < 0
                       THEN ABS(sm.qty_change) * COALESCE(sm.unit_cost, 0)
                     ELSE -ABS(sm.qty_change) * COALESCE(sm.unit_cost, 0)
                   END
            ELSE 0
          END
       ), 0) AS total_cogs
       FROM ims_stock_movements sm
       WHERE sm.business_id = ?
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
