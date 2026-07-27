/**
 * POST /api/xero/sync/daily-sales
 * Body: { databaseId, date, channel: 'online' }
 *
 * Posts the canonical summary invoice for a day's online sales.
 * POS revenue is posted exclusively by the per-method EOD flow.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncOnlineDailySalesDay } from '@/lib/xero/onlineDailySalesSync';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, date, channel } = await req.json();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!date || !channel) {
    return NextResponse.json({ error: 'date and channel are required.' }, { status: 400 });
  }
  if (channel !== 'online') {
    return NextResponse.json({
      error: 'Daily sales sync supports online sales only. POS revenue is synced through POS end-of-day reconciliation.',
    }, { status: 400 });
  }

  try {
    let preflightImport: { attempted: boolean; success: boolean; imported?: number; confirmedDrafts?: number; error?: string } = { attempted: false, success: false };
    preflightImport = { attempted: true, success: false };
    try {
      const fwHost = req.headers.get('x-forwarded-host');
      const origin = fwHost ? `https://${fwHost.split(',')[0].trim()}` : new URL(req.url).origin;
      const cookie = req.headers.get('cookie') ?? '';
      const importRes = await fetch(`${origin}/api/ims/shopify/import-orders`, {
        method: 'POST',
        headers: cookie ? { cookie } : undefined,
        cache: 'no-store',
      });
      const importJson = await importRes.json().catch(() => ({}));
      preflightImport = {
        attempted: true,
        success: importRes.ok && !!importJson?.success,
        imported: Number(importJson?.imported ?? 0),
        confirmedDrafts: Number(importJson?.confirmed_drafts ?? 0),
        error: importRes.ok ? undefined : String(importJson?.error ?? 'import failed'),
      };
    } catch (e: any) {
      preflightImport = { attempted: true, success: false, error: String(e?.message ?? e) };
    }

    if (preflightImport.attempted && !preflightImport.success) {
      await runImsForBusiness(databaseId, async () => {
        await notifySyncFailure({
          businessId: databaseId,
          source: 'shopify_sync',
          title: 'Shopify Sync Failed — Order Import Preflight',
          message: `Shopify import preflight failed before Xero online batch ${date}. ${preflightImport.error ?? 'Unknown error'}`,
          detail: { date, channel, error: preflightImport.error ?? null },
          dedupeKey: `shopify:preflight:${date}`,
          dedupeMinutes: 120,
        }).catch(() => {});
      }).catch(() => {});
    }

    const result = await syncOnlineDailySalesDay(databaseId, date);
    if (result.totalSales === 0) {
      return NextResponse.json({ success: false, message: 'No sales found for this date/channel.' });
    }
    return NextResponse.json({
      success: !!result.xeroId,
      xeroId: result.xeroId,
      totalSales: result.totalSales,
      totalTax: result.totalTax,
      preflightImport,
    });
  } catch (err: any) {
    console.error('[xero/daily-sales] error:', err?.message ?? err);
    await runImsForBusiness(databaseId, async () => {
      await notifySyncFailure({
        businessId: databaseId,
        source: 'xero_sync',
        title: 'Xero Sync Failed — Online Daily Batch',
        message: `Online daily sales batch ${date} failed. ${err?.message ?? 'Unknown error'}`,
        detail: { date, channel, error: err?.message ?? String(err) },
        dedupeKey: `xero:online-batch:${date}`,
        dedupeMinutes: 60,
      }).catch(() => {});
    }).catch(() => {});
    return NextResponse.json({ error: `Daily sales sync failed: ${err?.message ?? 'unknown error'}` }, { status: 500 });
  }
}
