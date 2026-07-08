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

  const results: { businessId: string; date: string; gateway?: string; success: boolean; error?: string }[] = [];

  for (const { business_id } of businesses) {
    // When Shopify Payments payout sync is on (cash basis), those orders are
    // posted via the payout flow instead — exclude them here to avoid double-counting.
    const spSettings = await imsQuery<{ key: string; value: string }>(
      "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('shopify_payments_payout_sync_enabled','shopify_revenue_basis')",
      [business_id],
    ).catch(() => [] as { key: string; value: string }[]);
    const spEnabled = spSettings.find(s => s.key === 'shopify_payments_payout_sync_enabled')?.value === '1';
    const basis = spSettings.find(s => s.key === 'shopify_revenue_basis')?.value || 'cash';
    const excludeSP = spEnabled && basis === 'cash';
    const gatewayFilter = excludeSP
      ? " AND (payment_gateway IS NULL OR payment_gateway NOT LIKE '%shopify_payments%')"
      : '';

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

      if (!combos.length) continue;

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
          const rows = await imsQuery<{ ts: string; tt: string; tc: string }>(
            `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                    COALESCE(SUM(tax_amount), 0)   AS tt,
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

      if (!days.length) continue;

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
          const rows = await imsQuery<{ ts: string; tt: string; tc: string }>(
            `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                    COALESCE(SUM(tax_amount), 0)   AS tt,
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
  }

  console.log('[auto-sync-cron]', results);
  return NextResponse.json({ ok: true, synced: results.filter(r => r.success).length, results });
}
