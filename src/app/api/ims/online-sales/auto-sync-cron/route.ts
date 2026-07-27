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
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { syncOnlineDailySalesDay } from '@/lib/xero/onlineDailySalesSync';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  // Iterate businesses from the main registry and bind each tenant's IMS schema
  // before querying orders. Do not discover businesses from the default IMS DB.
  let businesses: { business_id: string }[];
  try {
    businesses = await query<{ business_id: string }>(
      `SELECT business_id
       FROM businesses
       WHERE deleted_at IS NULL`,
      [],
    );
  } catch (e: any) {
    console.error('[auto-sync-cron] failed to load businesses:', e?.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: { businessId: string; date: string; success: boolean; error?: string }[] = [];

  // Each business's work runs inside its own bound IMS schema context
  // (callback form — the only AsyncLocalStorage pattern that reliably
  // propagates across awaits).
  const processBusiness = async (business_id: string) => {
    const timeZone = await getBusinessTimeZone(business_id);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone });
    const settingRows = await imsQuery<{ key: string; value: string }>(
      "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` = 'shopify_xero_auto_sync_enabled'",
      [business_id],
    ).catch(() => [] as { key: string; value: string }[]);
    const settings = new Map(settingRows.map(row => [row.key, row.value]));
    const xeroAutoSyncEnabled = settings.get('shopify_xero_auto_sync_enabled') !== '0';
    if (!xeroAutoSyncEnabled) return;

    const hasRecentOrders = await imsQuery<{ c: number }>(
      `SELECT COUNT(*) AS c
       FROM ims_sales_orders
       WHERE business_id = ?
         AND so_type = 'online'
         AND (is_historical IS NULL OR is_historical = 0)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?`,
      [business_id, today],
    ).catch(() => [] as { c: number }[]);
    if (Number(hasRecentOrders[0]?.c ?? 0) === 0) return;

    // Supported model: one invoice per completed business day.
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

      if (!days.length) return;

      const detailKeys = days.map(d => `online batch ${d.day}`);
      const synced = await query<{ batch_key: string }>(
        `SELECT detail AS batch_key FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
           AND detail IN (${detailKeys.map(() => '?').join(',')})`,
        [business_id, ...detailKeys],
      ).catch(() => [] as { batch_key: string }[]);
      const syncedSet = new Set(synced.map(r => String(r.batch_key).replace('online batch ', '')));

      for (const { day } of days.filter(d => !syncedSet.has(d.day))) {
        try {
          const result = await syncOnlineDailySalesDay(business_id, day);
          results.push({ businessId: business_id, date: day, success: !!result.xeroId });
        } catch (e: any) {
          results.push({ businessId: business_id, date: day, success: false, error: e?.message });
        }
    }

    const failedDays = results
      .filter(r => r.businessId === business_id && !r.success && !!r.date)
      .map(r => r.date);
    if (failedDays.length > 0) {
      await notifySyncFailure({
        businessId: business_id,
        source: 'xero_sync',
        title: 'Xero Sync Failed — Nightly Online Auto-Sync',
        message: `Nightly auto-sync could not post ${failedDays.length} online batch day${failedDays.length !== 1 ? 's' : ''}: ${failedDays.join(', ')}`,
        detail: { failed_days: failedDays },
        dedupeKey: `xero:auto-sync-cron:${failedDays.join('|')}`,
        dedupeMinutes: 180,
      }).catch(() => {});
    }
  };

  for (const { business_id } of businesses) {
    try {
      await runImsForBusiness(business_id, () => processBusiness(business_id));
    } catch (e: any) {
      results.push({ businessId: business_id, date: '', success: false, error: e?.message });
    }
  }

  console.log('[auto-sync-cron]', results);
  return NextResponse.json({ ok: true, synced: results.filter(r => r.success).length, results });
}
