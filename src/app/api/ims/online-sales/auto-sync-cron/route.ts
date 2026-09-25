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
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { getOnlineChannelCapabilities } from '@/lib/ims/businessOperations';

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
       WHERE deleted_at IS NULL
         AND COALESCE(automation_paused, 0) = 0`,
      [],
    );
  } catch (e: any) {
    console.error('[auto-sync-cron] failed to load businesses:', e?.message);
    await reportRuntimeIssue({
      source: 'cron',
      operation: 'online_sales_load_businesses',
      severity: 'critical',
      title: 'Nightly online sales sync could not load organisations',
      error: e,
    });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const results: { businessId: string; channelInstanceId: string; date: string; success: boolean; error?: string }[] = [];

  // Each business's work runs inside its own bound IMS schema context
  // (callback form — the only AsyncLocalStorage pattern that reliably
  // propagates across awaits).
  const processBusiness = async (business_id: string) => {
    const timeZone = await getBusinessTimeZone(business_id);
    const capabilities = await getOnlineChannelCapabilities(business_id);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone });
    const channelRows = await query<{ channel_instance_id: string; provider: string; settings_json: string | Record<string, unknown> | null }>(
      `SELECT channel_instance_id, provider, settings_json FROM sales_channel_instances
        WHERE business_id = ? AND provider IN ('shopify','native_shop')
          AND is_enabled = 1 AND runtime_status = 'active' AND readiness_status = 'ready'`,
      [business_id],
    );
    const enabledChannelIds = new Set(channelRows.filter(instance => {
      if (instance.provider === 'native_shop') return capabilities.nativeShopEnabled;
      if (!capabilities.shopifyEnabled) return false;
      let raw: Record<string, unknown> = {};
      try { raw = typeof instance.settings_json === 'string' ? JSON.parse(instance.settings_json) : instance.settings_json ?? {}; } catch {}
      return shopifyInstanceSettings(raw).xero.dailyAutoSyncEnabled;
    }).map(instance => instance.channel_instance_id));
    if (enabledChannelIds.size === 0) return;

    // Supported model: one invoice per exact channel and completed business day.
      const days = await imsQuery<{ day: string; channel_instance_id: string }>(
        `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day, channel_instance_id
         FROM ims_sales_orders
         WHERE so_type = 'online' AND business_id = ?
           AND is_staff_preview_test = 0
           AND (is_historical IS NULL OR is_historical = 0)
           AND status != 'cancelled'
           AND channel_instance_id IS NOT NULL
           AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
           AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?
         GROUP BY channel_instance_id, DATE_FORMAT(order_date, '%Y-%m-%d')`,
        [business_id, today],
      ).catch(() => [] as { day: string }[]);

      if (!days.length) return;

      const detailKeys = days.map(d => `online batch ${d.channel_instance_id} ${d.day}`);
      const synced = await query<{ batch_key: string }>(
        `SELECT detail AS batch_key FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
           AND detail IN (${detailKeys.map(() => '?').join(',')})`,
        [business_id, ...detailKeys],
      ).catch(() => [] as { batch_key: string }[]);
      const syncedSet = new Set(synced.map(r => String(r.batch_key)));

      for (const { day, channel_instance_id } of days.filter(d => enabledChannelIds.has(d.channel_instance_id) && !syncedSet.has(`online batch ${d.channel_instance_id} ${d.day}`))) {
        try {
          const result = await syncOnlineDailySalesDay(business_id, day, channel_instance_id);
          results.push({ businessId: business_id, channelInstanceId: channel_instance_id, date: day, success: !!result.xeroId });
        } catch (e: any) {
          results.push({ businessId: business_id, channelInstanceId: channel_instance_id, date: day, success: false, error: e?.message });
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
        detail: {
          failed_days: failedDays,
          failed_channels: results.filter(result => result.businessId === business_id && !result.success).map(result => result.channelInstanceId),
        },
        dedupeKey: `xero:auto-sync-cron:${failedDays.join('|')}`,
        dedupeMinutes: 180,
      }).catch(() => {});
    }
  };

  for (const { business_id } of businesses) {
    try {
      await runImsForBusiness(business_id, () => processBusiness(business_id));
    } catch (e: any) {
      await reportRuntimeIssue({
        businessId: business_id,
        source: 'cron',
        operation: 'online_sales_auto_sync',
        title: 'Nightly online sales sync failed for organisation',
        error: e,
      });
      results.push({ businessId: business_id, date: '', success: false, error: e?.message });
    }
  }

  console.log('[auto-sync-cron]', results);
  const failed = results.filter(result => !result.success).length;
  return NextResponse.json(
    { ok: failed === 0, synced: results.filter(result => result.success).length, failed, results },
    { status: failed === 0 ? 200 : 207 },
  );
}
