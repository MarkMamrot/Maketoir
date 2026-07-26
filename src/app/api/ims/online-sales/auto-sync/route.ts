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
import { getImsSession } from '@/lib/auth/imsSession';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { syncOnlineDailySalesDay } from '@/lib/xero/onlineDailySalesSync';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

export async function POST(req: Request) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  const businessId = session?.businessId;
  if (!businessId) return NextResponse.json({ skipped: true, reason: 'unauthenticated' });

  const settingsRows = await imsQuery<{ key: string; value: string }>(
    "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` = 'shopify_xero_auto_sync_enabled'",
    [businessId],
  ).catch(() => [] as { key: string; value: string }[]);
  const settings = new Map(settingsRows.map(row => [row.key, row.value]));
  const xeroAutoSyncEnabled = settings.get('shopify_xero_auto_sync_enabled') !== '0';
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

  const timeZone = await getBusinessTimeZone(businessId);

  // Today in business timezone — don't sync today (incomplete day)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone });

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
        const result = await syncOnlineDailySalesDay(businessId, day);
        results.push({ date: day, success: !!result.xeroId });
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
