/**
 * POST /api/ims/online-sales/auto-sync
 *
 * Called once per IMS session on login to silently sync any online sales batch
 * days that have orders but have not yet been pushed to Xero.
 *
 * Checks the last 14 days (excluding today) for unsynced batches.
 * Runs non-blocking — always returns quickly; any Xero errors are logged but
 * do not surface to the user.
 */
import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { syncDailySalesBatch } from '@/services/XeroSyncService';
import { getImsSession } from '@/lib/auth/imsSession';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

export async function POST(req: Request) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  const businessId = session?.businessId;
  if (!businessId) return NextResponse.json({ skipped: true, reason: 'unauthenticated' });

  const setting = await imsQuery<{ value: string }>(
    "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'shopify_xero_auto_sync_enabled' LIMIT 1",
    [businessId],
  ).catch(() => [] as { value: string }[]);
  const xeroAutoSyncEnabled = setting[0]?.value !== '0';
  if (!xeroAutoSyncEnabled) {
    return NextResponse.json({ skipped: true, reason: 'setting_disabled' });
  }

  // Best-effort preflight import to close webhook gaps before batching to Xero.
  const preflightImport: { attempted: boolean; success: boolean; imported?: number; confirmedDrafts?: number; error?: string } = { attempted: true, success: false };
  try {
    const fwHost = req.headers.get('x-forwarded-host');
    const origin = fwHost
      ? `https://${fwHost.split(',')[0].trim()}`
      : new URL(req.url).origin;
    const cookie = req.headers.get('cookie') ?? '';
    const importRes = await fetch(`${origin}/api/ims/shopify/import-orders`, {
      method: 'POST',
      headers: cookie ? { cookie } : undefined,
      cache: 'no-store',
    });
    const importJson = await importRes.json().catch(() => ({}));
    preflightImport.success = importRes.ok && !!importJson?.success;
    preflightImport.imported = Number(importJson?.imported ?? 0);
    preflightImport.confirmedDrafts = Number(importJson?.confirmed_drafts ?? 0);
    if (!importRes.ok) preflightImport.error = String(importJson?.error ?? 'import failed');
  } catch (e: any) {
    preflightImport.error = String(e?.message ?? e);
  }

  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';

  // Today in business timezone — don't sync today (incomplete day)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

  try {
    // Find days with syncable online orders in the last 14 days
    const days = await imsQuery<{ day: string }>(
      `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day
       FROM ims_sales_orders
       WHERE so_type = 'online'
         AND business_id = ?
         AND (is_historical IS NULL OR is_historical = 0)
         AND status != 'cancelled'
         AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?
       GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d')`,
      [businessId, today],
    );

    if (!days.length) return NextResponse.json({ synced: [], skipped_already_done: 0 });

    // Check which are already synced in xero_sync_log
    const detailKeys = days.map(d => `online batch ${d.day}`);
    const alreadySynced = await query<{ batch_key: string }>(
      `SELECT detail AS batch_key FROM xero_sync_log
       WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
         AND detail IN (${detailKeys.map(() => '?').join(',')})`,
      [businessId, ...detailKeys],
    ).catch(() => []);

    const syncedKeys = new Set(alreadySynced.map(r => String(r.batch_key).replace('online batch ', '')));
    const toSync = days.filter(d => !syncedKeys.has(d.day));

    const results: { date: string; success: boolean }[] = [];
    for (const { day } of toSync) {
      try {
        // Aggregate for the day
        const rows = await imsQuery<{ total_sales: string; total_tax: string; txn_count: string }>(
          `SELECT COALESCE(SUM(total_amount), 0) AS total_sales,
                  COALESCE(SUM(tax_amount), 0) AS total_tax,
                  COUNT(*) AS txn_count
           FROM ims_sales_orders
           WHERE business_id = ? AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
             AND so_type = 'online'
             AND (is_historical IS NULL OR is_historical = 0)
             AND status != 'cancelled'`,
          [businessId, day],
        );
        const totalSales = Number(rows[0]?.total_sales ?? 0);
        const totalTax   = Number(rows[0]?.total_tax   ?? 0);
        const count      = Number(rows[0]?.txn_count   ?? 0);
        if (totalSales === 0) { results.push({ date: day, success: false }); continue; }

        await syncDailySalesBatch(businessId, {
          date: day,
          channel: 'online',
          totalSales,
          totalTax,
          lineDescription: `Online Sales ${day} (${count} orders)`,
        });
        results.push({ date: day, success: true });
      } catch {
        results.push({ date: day, success: false });
      }
    }

    return NextResponse.json({
      synced: results.filter(r => r.success).map(r => r.date),
      failed: results.filter(r => !r.success).map(r => r.date),
      skipped_already_done: syncedKeys.size,
      preflightImport,
    });
  } catch {
    return NextResponse.json({ skipped: true, reason: 'error', preflightImport });
  }
}
