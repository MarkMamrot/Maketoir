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
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

function normalizeGateway(value: string | null | undefined): string {
  const v = String(value ?? '').trim().toLowerCase();
  return v || '_unknown';
}

function findGatewayClearingAccount(
  gateway: string,
  mappings: Array<{ gateway_name: string; clearing_account_code: string | null }>,
): string | null {
  const key = normalizeGateway(gateway);
  for (const mapping of mappings) {
    const name = normalizeGateway(mapping.gateway_name);
    if (!name || !mapping.clearing_account_code) continue;
    if (key.includes(name) || name.includes(key)) return mapping.clearing_account_code;
  }
  return null;
}

export async function POST(req: Request) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  const businessId = session?.businessId;
  if (!businessId) return NextResponse.json({ skipped: true, reason: 'unauthenticated' });

  const settingsRows = await imsQuery<{ key: string; value: string }>(
    "SELECT `key`, value FROM ims_settings WHERE business_id = ? AND `key` IN ('shopify_xero_auto_sync_enabled', 'shopify_xero_online_batch_mode')",
    [businessId],
  ).catch(() => [] as { key: string; value: string }[]);
  const settings = new Map(settingsRows.map(row => [row.key, row.value]));
  const xeroAutoSyncEnabled = settings.get('shopify_xero_auto_sync_enabled') !== '0';
  const onlineBatchMode = settings.get('shopify_xero_online_batch_mode') === 'combined'
    ? 'combined'
    : 'per_gateway';
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
    const gwMappings = await query<{ gateway_name: string; clearing_account_code: string | null }>(
      `SELECT gateway_name, clearing_account_code FROM xero_gateway_mappings WHERE business_id = ?`,
      [businessId],
    ).catch(() => [] as { gateway_name: string; clearing_account_code: string | null }[]);
    const hasGatewayMappings = gwMappings.length > 0;
    const shouldUsePerGateway = onlineBatchMode === 'per_gateway' && hasGatewayMappings;

    if (shouldUsePerGateway) {
      const combos = await imsQuery<{ day: string; gateway: string }>(
        `SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS day,
                COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') AS gateway
         FROM ims_sales_orders
         WHERE so_type = 'online'
           AND business_id = ?
           AND (is_historical IS NULL OR is_historical = 0)
           AND status != 'cancelled'
           AND DATE_FORMAT(order_date, '%Y-%m-%d') >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
           AND DATE_FORMAT(order_date, '%Y-%m-%d') < ?
         GROUP BY DATE_FORMAT(order_date, '%Y-%m-%d'), COALESCE(LOWER(TRIM(payment_gateway)), '_unknown')`,
        [businessId, today],
      );

      if (!combos.length) {
        return NextResponse.json({ synced: [], failed: [], skipped_already_done: 0, preflightImport, mode: onlineBatchMode });
      }

      const detailKeys = combos.map(c => `online batch ${c.day}|${c.gateway}`);
      const alreadySynced = await query<{ batch_key: string }>(
        `SELECT detail AS batch_key FROM xero_sync_log
         WHERE business_id = ? AND sync_type = 'online_batch' AND status = 'success'
           AND detail IN (${detailKeys.map(() => '?').join(',')})`,
        [businessId, ...detailKeys],
      ).catch(() => []);

      const syncedKeys = new Set(alreadySynced.map(r => String(r.batch_key)));
      const toSync = combos.filter(c => !syncedKeys.has(`online batch ${c.day}|${c.gateway}`));

      const results: { date: string; gateway: string; success: boolean }[] = [];
      for (const { day, gateway } of toSync) {
        try {
          const rows = await imsQuery<{ ts: string; tt: string; tc: string }>(
            `SELECT COALESCE(SUM(total_amount), 0) AS ts,
                    COALESCE(SUM(tax_amount), 0) AS tt,
                    COUNT(*) AS tc
             FROM ims_sales_orders
             WHERE business_id = ?
               AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
               AND so_type = 'online'
               AND (is_historical IS NULL OR is_historical = 0)
               AND status != 'cancelled'
               AND COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') = ?`,
            [businessId, day, gateway],
          );
          const totalSales = Number(rows[0]?.ts ?? 0);
          const totalTax = Number(rows[0]?.tt ?? 0);
          const count = Number(rows[0]?.tc ?? 0);
          if (totalSales === 0) { results.push({ date: day, gateway, success: false }); continue; }

          const clearingCode = findGatewayClearingAccount(gateway, gwMappings) ?? undefined;

          const displayGateway = gateway === '_unknown' ? 'Unknown' : gateway;
          await syncDailySalesBatch(businessId, {
            date: day,
            channel: 'online',
            totalSales,
            totalTax,
            lineDescription: `Online Sales ${day} via ${displayGateway} (${count} orders)`,
            gateway,
            clearingAccountCode: clearingCode ?? undefined,
          });
          results.push({ date: day, gateway, success: true });
        } catch {
          results.push({ date: day, gateway, success: false });
        }
      }

      return NextResponse.json({
        mode: onlineBatchMode,
        synced: results.filter(r => r.success).map(r => `${r.date}|${r.gateway}`),
        failed: results.filter(r => !r.success).map(r => `${r.date}|${r.gateway}`),
        skipped_already_done: syncedKeys.size,
        preflightImport,
      });
    }

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

        const gatewayRows = await imsQuery<{ gateway: string; ts: string; tt: string }>(
          `SELECT COALESCE(LOWER(TRIM(payment_gateway)), '_unknown') AS gateway,
                  COALESCE(SUM(total_amount), 0) AS ts,
                  COALESCE(SUM(tax_amount), 0) AS tt
             FROM ims_sales_orders
            WHERE business_id = ?
              AND DATE_FORMAT(order_date, '%Y-%m-%d') = ?
              AND so_type = 'online'
              AND (is_historical IS NULL OR is_historical = 0)
              AND status != 'cancelled'
            GROUP BY COALESCE(LOWER(TRIM(payment_gateway)), '_unknown')`,
          [businessId, day],
        );

        const paymentRows = gatewayRows
          .map(row => {
            const gateway = normalizeGateway(row.gateway);
            const amount = Math.round((Number(row.ts ?? 0) + Number(row.tt ?? 0)) * 100) / 100;
            if (!(amount > 0)) return null;
            const accountCode = findGatewayClearingAccount(gateway, gwMappings);
            return {
              gateway,
              amount,
              accountCode,
            };
          })
          .filter((row): row is { gateway: string; amount: number; accountCode: string | null } => !!row);

        const missingMappings = paymentRows.filter(row => !row.accountCode);
        if (gwMappings.length > 0 && missingMappings.length > 0) {
          results.push({ date: day, success: false });
          continue;
        }

        const targetTotal = Math.round((totalSales + totalTax) * 100) / 100;
        const clearingPayments = paymentRows
          .filter(row => !!row.accountCode)
          .map(row => ({
            accountCode: row.accountCode as string,
            amount: row.amount,
            label: row.gateway === '_unknown' ? 'Unknown' : row.gateway,
          }));
        if (clearingPayments.length > 0) {
          const allocated = Math.round(clearingPayments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
          const delta = Math.round((targetTotal - allocated) * 100) / 100;
          if (Math.abs(delta) > 0.00001) {
            const last = clearingPayments[clearingPayments.length - 1];
            last.amount = Math.round((last.amount + delta) * 100) / 100;
          }
        }

        await syncDailySalesBatch(businessId, {
          date: day,
          channel: 'online',
          totalSales,
          totalTax,
          lineDescription: `Online Sales ${day} (${count} orders)`,
          ...(clearingPayments.length > 0 ? { clearingPayments } : {}),
        });
        results.push({ date: day, success: true });
      } catch {
        results.push({ date: day, success: false });
      }
    }

    return NextResponse.json({
      mode: onlineBatchMode,
      synced: results.filter(r => r.success).map(r => r.date),
      failed: results.filter(r => !r.success).map(r => r.date),
      skipped_already_done: syncedKeys.size,
      preflightImport,
    });
  } catch {
    return NextResponse.json({ skipped: true, reason: 'error', preflightImport });
  }
}
