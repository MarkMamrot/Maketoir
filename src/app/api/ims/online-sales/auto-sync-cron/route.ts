/**
 * POST /api/ims/online-sales/auto-sync-cron
 *
 * Called by GitHub Actions at 1am AEST every night.
 * Authenticated by a shared secret in the x-cron-secret header — no user
 * session required. Set CRON_SECRET in both Railway env vars and GitHub
 * Actions secrets.
 *
 * Finds all businesses with unsynced online sales batches in the last 7 days
 * and pushes each one to Xero as a daily summary invoice.
 */
import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { syncDailySalesBatch } from '@/services/XeroSyncService';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

  // Find all businesses that have online orders in the look-back window.
  // Multi-tenant safe — each gets its own Xero sync using its own OAuth token.
  let businesses: { business_id: string }[];
  try {
    businesses = await imsQuery<{ business_id: string }>(
      `SELECT DISTINCT business_id
       FROM ims_sales_orders
       WHERE so_type = 'online'
         AND (is_historical IS NULL OR is_historical = 0)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?`,
      [today],
    );
  } catch (e: any) {
    console.error('[auto-sync-cron] failed to load businesses:', e?.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: { businessId: string; date: string; success: boolean; error?: string }[] = [];

  for (const { business_id } of businesses) {
    // Find days with syncable orders for this business
    const days = await imsQuery<{ day: string }>(
      `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day
       FROM ims_sales_orders
       WHERE so_type = 'online' AND business_id = ?
         AND (is_historical IS NULL OR is_historical = 0)
         AND status != 'cancelled'
         AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?
       GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d')`,
      [business_id, today],
    ).catch(() => [] as { day: string }[]);

    if (!days.length) continue;

    // Which of these days are already successfully synced?
    const detailKeys = days.map(d => `online batch ${d.day}`);
    const synced = await query<{ batch_key: string }>(
      `SELECT detail AS batch_key FROM xero_sync_log
       WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
         AND detail IN (${detailKeys.map(() => '?').join(',')})`,
      [business_id, ...detailKeys],
    ).catch(() => [] as { batch_key: string }[]);
    const syncedSet = new Set(synced.map(r => String(r.batch_key).replace('online batch ', '')));

    // Sync each unsynced day
    for (const { day } of days.filter(d => !syncedSet.has(d.day))) {
      try {
        const rows = await imsQuery<{ ts: string; tt: string; tc: string }>(
          `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                  COALESCE(SUM(tax_amount), 0)   AS tt,
                  COUNT(*) AS tc
           FROM ims_sales_orders
           WHERE business_id = ?
             AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
             AND so_type = 'online'
             AND (is_historical IS NULL OR is_historical = 0)
             AND status != 'cancelled'`,
          [business_id, day],
        );
        const totalSales = Number(rows[0]?.ts ?? 0);
        const totalTax   = Number(rows[0]?.tt ?? 0);
        const count      = Number(rows[0]?.tc ?? 0);
        if (totalSales === 0) continue;

        await syncDailySalesBatch(business_id, {
          date: day,
          channel: 'online',
          totalSales,
          totalTax,
          lineDescription: `Online Sales ${day} (${count} orders)`,
        });
        results.push({ businessId: business_id, date: day, success: true });
      } catch (e: any) {
        results.push({ businessId: business_id, date: day, success: false, error: e?.message });
      }
    }
  }

  console.log('[auto-sync-cron]', results);
  return NextResponse.json({ ok: true, synced: results.filter(r => r.success).length, results });
}
