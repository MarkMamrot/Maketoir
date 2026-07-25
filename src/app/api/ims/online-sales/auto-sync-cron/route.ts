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
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { syncDailySalesBatch, syncGiftCardLiabilityReclass } from '@/services/XeroSyncService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const tz = process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });

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

  const results: { businessId: string; date: string; gateway?: string; success: boolean; error?: string }[] = [];

  // Each business's work runs inside its own bound IMS schema context
  // (callback form — the only AsyncLocalStorage pattern that reliably
  // propagates across awaits).
  const processBusiness = async (business_id: string) => {
    const settingRows = await imsQuery<{ value: string }>(
      "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'shopify_xero_auto_sync_enabled' LIMIT 1",
      [business_id],
    ).catch(() => [] as { value: string }[]);
    const xeroAutoSyncEnabled = settingRows[0]?.value !== '0';
    if (!xeroAutoSyncEnabled) return;

    // Rolling migration safety: needed for gift-card liability reclass in online batch.
    await imsExecute(
      `ALTER TABLE ims_sales_orders
       ADD COLUMN gift_card_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount`,
      [],
    ).catch(() => {});

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

    const gatewayFilter = '';

    // Load gateway clearing-account mappings for this business.
    const gwMappings = await query<{ gateway_name: string; clearing_account_code: string | null }>(
      `SELECT gateway_name, clearing_account_code FROM xero_gateway_mappings WHERE business_id = ?`,
      [business_id],
    ).catch(() => [] as { gateway_name: string; clearing_account_code: string | null }[]);
    const gatewayMap = new Map(gwMappings.map(m => [m.gateway_name, m.clearing_account_code]));
    const hasGatewayMappings = gatewayMap.size > 0;

    if (hasGatewayMappings) {
      // ── Per-gateway mode: one invoice per (day × gateway) ─────────────────
      // Find distinct (day, gateway) combos with syncable orders.
      const combos = await imsQuery<{ day: string; gateway: string }>(
        `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day,
                COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') AS gateway
         FROM ims_sales_orders
         WHERE so_type = 'online' AND business_id = ?
           AND (is_historical IS NULL OR is_historical = 0)
           AND status != 'cancelled'
           AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
           AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?${gatewayFilter}
         GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d'), COALESCE(LOWER(TRIM(payment_gateway)), '_unknown')`,
        [business_id, today],
      ).catch(() => [] as { day: string; gateway: string }[]);

      if (!combos.length) return;

      // Which (day, gateway) combos are already synced? Detail format: 'online batch YYYY-MM-DD|gateway'
      const detailKeys = combos.map(c => `online batch ${c.day}|${c.gateway}`);
      const synced = await query<{ batch_key: string }>(
        `SELECT detail AS batch_key FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
           AND detail IN (${detailKeys.map(() => '?').join(',')})`,
        [business_id, ...detailKeys],
      ).catch(() => [] as { batch_key: string }[]);
      const syncedSet = new Set(synced.map(r => String(r.batch_key)));

      for (const { day, gateway } of combos) {
        const key = `online batch ${day}|${gateway}`;
        if (syncedSet.has(key)) continue;
        try {
          const rows = await imsQuery<{ ts: string; tt: string; tc: string; gca: string }>(
            `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                    COALESCE(SUM(tax_amount), 0)   AS tt,
                    COALESCE(SUM(gift_card_amount), 0) AS gca,
                    COUNT(*) AS tc
             FROM ims_sales_orders
             WHERE business_id = ?
               AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
               AND so_type = 'online'
               AND (is_historical IS NULL OR is_historical = 0)
               AND status != 'cancelled'
               AND COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') = ?${gatewayFilter}`,
            [business_id, day, gateway],
          );
          const totalSales = Number(rows[0]?.ts ?? 0);
          const totalTax   = Number(rows[0]?.tt ?? 0);
          const giftCardAmount = Number(rows[0]?.gca ?? 0);
          const count      = Number(rows[0]?.tc ?? 0);
          if (totalSales === 0) continue;

          // Fuzzy-match gateway to configured mappings (the stored gateway_name uses LIKE).
          const clearingCode = gwMappings.find(m =>
            gateway.includes(m.gateway_name) || m.gateway_name.includes(gateway),
          )?.clearing_account_code ?? undefined;

          const displayGateway = gateway === '_unknown' ? 'Unknown' : gateway;
          await syncDailySalesBatch(business_id, {
            date: day,
            channel: 'online',
            totalSales,
            totalTax,
            lineDescription: `Online Sales ${day} via ${displayGateway} (${count} orders)`,
            gateway,
            clearingAccountCode: clearingCode ?? undefined,
          });
          if (giftCardAmount > 0) {
            await syncGiftCardLiabilityReclass({
              businessId: business_id,
              amount: giftCardAmount,
              date: day,
              channel: 'online',
              gateway,
              dedupeKey: `gift card liability online ${day}|${gateway}`,
            });
          }
          results.push({ businessId: business_id, date: day, gateway, success: true });
        } catch (e: any) {
          results.push({ businessId: business_id, date: day, gateway, success: false, error: e?.message });
        }
      }
    } else {
      // ── Legacy combined mode: one invoice per day (original behaviour) ──────
      const days = await imsQuery<{ day: string }>(
        `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day
         FROM ims_sales_orders
         WHERE so_type = 'online' AND business_id = ?
           AND (is_historical IS NULL OR is_historical = 0)
           AND status != 'cancelled'
           AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
           AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?${gatewayFilter}
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
          const rows = await imsQuery<{ ts: string; tt: string; tc: string; gca: string }>(
            `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                    COALESCE(SUM(tax_amount), 0)   AS tt,
                    COALESCE(SUM(gift_card_amount), 0) AS gca,
                    COUNT(*) AS tc
             FROM ims_sales_orders
             WHERE business_id = ?
               AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
               AND so_type = 'online'
               AND (is_historical IS NULL OR is_historical = 0)
               AND status != 'cancelled'${gatewayFilter}`,
            [business_id, day],
          );
          const totalSales = Number(rows[0]?.ts ?? 0);
          const totalTax   = Number(rows[0]?.tt ?? 0);
          const giftCardAmount = Number(rows[0]?.gca ?? 0);
          const count      = Number(rows[0]?.tc ?? 0);
          if (totalSales === 0) continue;

          await syncDailySalesBatch(business_id, {
            date: day,
            channel: 'online',
            totalSales,
            totalTax,
            lineDescription: `Online Sales ${day} (${count} orders)`,
          });
          if (giftCardAmount > 0) {
            await syncGiftCardLiabilityReclass({
              businessId: business_id,
              amount: giftCardAmount,
              date: day,
              channel: 'online',
              dedupeKey: `gift card liability online ${day}`,
            });
          }
          results.push({ businessId: business_id, date: day, success: true });
        } catch (e: any) {
          results.push({ businessId: business_id, date: day, success: false, error: e?.message });
        }
      }
    }
  };

  for (const { business_id } of businesses) {
    try {
      await runImsForBusiness(business_id, () => processBusiness(business_id));
    } catch (e: any) {
      results.push({ businessId: business_id, date: today, success: false, error: e?.message });
    }
  }

  console.log('[auto-sync-cron]', results);
  return NextResponse.json({ ok: true, synced: results.filter(r => r.success).length, results });
}
