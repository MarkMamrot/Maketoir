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
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

export async function POST(req: Request) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  const businessId = session?.businessId;
  if (!businessId) return NextResponse.json({ skipped: true, reason: 'unauthenticated' });

  const channelInstances = await query<{ channel_instance_id: string; provider: string; settings_json: string | Record<string, unknown> | null }>(
    `SELECT channel_instance_id, provider, settings_json FROM sales_channel_instances
      WHERE business_id = ? AND provider IN ('shopify','native_shop')
        AND is_enabled = 1 AND runtime_status = 'active' AND readiness_status = 'ready'`,
    [businessId],
  ).catch(() => [] as { channel_instance_id: string; provider: string; settings_json: string | Record<string, unknown> | null }[]);
  const enabledChannelInstances = channelInstances.filter(instance => {
    if (instance.provider !== 'shopify') return true;
    let raw: Record<string, unknown> = {};
    try { raw = typeof instance.settings_json === 'string' ? JSON.parse(instance.settings_json) : instance.settings_json ?? {}; } catch {}
    return shopifyInstanceSettings(raw).xero.dailyAutoSyncEnabled;
  });
  if (enabledChannelInstances.length === 0) return NextResponse.json({ skipped: true, reason: 'setting_disabled' });

  // Best-effort preflight import to close webhook gaps before batching each Shopify store.
  const preflightImport: Array<{ channelInstanceId: string; success: boolean; imported?: number; error?: string }> = [];
  const fwHost = req.headers.get('x-forwarded-host');
  const origin = fwHost ? `https://${fwHost.split(',')[0].trim()}` : new URL(req.url).origin;
  const cookie = req.headers.get('cookie') ?? '';
  for (const channel of enabledChannelInstances.filter(instance => instance.provider === 'shopify')) {
    try {
      const importRes = await fetch(`${origin}/api/ims/shopify/import-orders`, {
        method: 'POST',
        headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelInstanceId: channel.channel_instance_id }),
        cache: 'no-store',
      });
      const importJson = await importRes.json().catch(() => ({}));
      preflightImport.push({
        channelInstanceId: channel.channel_instance_id,
        success: importRes.ok && !!importJson?.success,
        imported: Number(importJson?.imported ?? 0),
        ...(!importRes.ok ? { error: String(importJson?.error ?? 'import failed') } : {}),
      });
    } catch (error) {
      preflightImport.push({ channelInstanceId: channel.channel_instance_id, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const timeZone = await getBusinessTimeZone(businessId);

  // Today in business timezone — don't sync today (incomplete day)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone });

  try {
    // Find days with syncable online orders in the last 14 days
    const days = await imsQuery<{ day: string; channel_instance_id: string }>(
      `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day, channel_instance_id
       FROM ims_sales_orders
       WHERE so_type = 'online'
         AND business_id = ?
         AND (is_historical IS NULL OR is_historical = 0)
         AND status != 'cancelled'
         AND channel_instance_id IS NOT NULL
         AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
         AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?
      GROUP BY channel_instance_id, DATE_FORMAT(order_date, '%Y-%m-%d')`,
      [businessId, today],
    );

    if (!days.length) return NextResponse.json({ synced: [], skipped_already_done: 0 });

    // Check which are already synced in xero_sync_log
    const detailKeys = days.map(d => `online batch ${d.channel_instance_id} ${d.day}`);
    const alreadySynced = await query<{ batch_key: string }>(
      `SELECT detail AS batch_key FROM xero_sync_log
       WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
         AND detail IN (${detailKeys.map(() => '?').join(',')})`,
      [businessId, ...detailKeys],
    ).catch(() => []);

    const syncedKeys = new Set(alreadySynced.map(r => String(r.batch_key)));
    const enabledIds = new Set(enabledChannelInstances.map(instance => instance.channel_instance_id));
    const toSync = days.filter(d => enabledIds.has(d.channel_instance_id) && !syncedKeys.has(`online batch ${d.channel_instance_id} ${d.day}`));

    const results: { date: string; channelInstanceId: string; success: boolean }[] = [];
    for (const { day, channel_instance_id } of toSync) {
      try {
        const result = await syncOnlineDailySalesDay(businessId, day, channel_instance_id);
        results.push({ date: day, channelInstanceId: channel_instance_id, success: !!result.xeroId });
      } catch {
        results.push({ date: day, channelInstanceId: channel_instance_id, success: false });
      }
    }

    const failedDays = results.filter(r => !r.success).map(r => r.date);
    if (failedDays.length > 0) {
      await notifySyncFailure({
        businessId,
        source: 'xero_sync',
        title: 'Xero Sync Failed — Online Auto-Sync',
        message: `Auto-sync could not post ${failedDays.length} online batch day${failedDays.length !== 1 ? 's' : ''}: ${failedDays.join(', ')}`,
        detail: { failed_days: failedDays, failed_channels: results.filter(result => !result.success).map(result => result.channelInstanceId) },
        dedupeKey: `xero:auto-sync:${failedDays.join('|')}`,
        dedupeMinutes: 120,
      }).catch(() => {});
    }

    return NextResponse.json({
      synced: results.filter(r => r.success),
      failed: results.filter(r => !r.success),
      skipped_already_done: syncedKeys.size,
      preflightImport,
    });
  } catch {
    return NextResponse.json({ skipped: true, reason: 'error', preflightImport });
  }
}
