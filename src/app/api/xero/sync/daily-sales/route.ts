/**
 * POST /api/xero/sync/daily-sales
 * Body: { databaseId, date, channel: 'online', channelInstanceId }
 *
 * Posts the canonical summary invoice for a day's online sales.
 * POS revenue is posted exclusively by the per-method EOD flow.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { syncOnlineDailySalesDay } from '@/lib/xero/onlineDailySalesSync';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { notifySyncFailure } from '@/lib/ims/notifySyncFailure';
import { getXeroSyncAccessDenied } from '@/lib/xero/advisorSyncAccess';
import { getOnlineDailyAccountingReadiness } from '@/lib/xero/onlineDailyAccountingRecovery';
import { enqueueOnlineSyncJob } from '@/lib/channels/onlineSyncJobs';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { databaseId, date, channel, channelInstanceId: rawChannelInstanceId } = await req.json();
  const channelInstanceId = String(rawChannelInstanceId ?? '').trim();
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  const syncDenied = await getXeroSyncAccessDenied(user);
  if (syncDenied) return syncDenied;

  if (!date || !channel) {
    return NextResponse.json({ error: 'date and channel are required.' }, { status: 400 });
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: 'A valid accounting date (YYYY-MM-DD) is required.' }, { status: 400 });
  }
  if (channel !== 'online') {
    return NextResponse.json({
      error: 'Daily sales sync supports online sales only. POS revenue is synced through POS end-of-day reconciliation.',
    }, { status: 400 });
  }
  if (!channelInstanceId) {
    return NextResponse.json({ error: 'channelInstanceId is required for online daily sales.' }, { status: 400 });
  }

  try {
    const readiness = await getOnlineDailyAccountingReadiness({ businessId: databaseId, channelInstanceId, date, manual: true });
    if (readiness.active) {
      let jobStatus: string | null = null;
      if (readiness.provider && !readiness.reviewRequired) {
        jobStatus = await runImsForBusiness(databaseId, async () => {
          const payload = { kind: 'daily_accounting' as const, date, manual: true as const };
          await enqueueOnlineSyncJob({
            businessId: databaseId,
            channelInstanceId,
            provider: readiness.provider!,
            operation: 'online_daily_accounting',
            operationKey: date,
            payload,
          });
          // Promote only idle canonical work; never replace an in-flight worker's policy or lease.
          await imsExecute(
            `UPDATE ims_sales_channel_jobs job
              JOIN ims_online_sync_control control ON BINARY control.business_id = BINARY job.business_id
              SET job.payload_json = ?, job.status = 'pending', job.available_at = UTC_TIMESTAMP(3)
              WHERE BINARY job.business_id = BINARY ? AND BINARY job.channel_instance_id = BINARY ?
                AND job.provider = ? AND job.operation = 'online_daily_accounting' AND BINARY job.operation_key = BINARY ?
                AND job.status <> 'processing' AND (job.lease_token IS NULL OR job.lease_expires_at <= UTC_TIMESTAMP(3))
                AND control.rollout_state = 'cutover' AND control.paused = 0`,
            [JSON.stringify(payload), databaseId, channelInstanceId, readiness.provider, date],
          );
          const jobs = await imsQuery<{ status: string }>(
            `SELECT job.status FROM ims_sales_channel_jobs job
              JOIN ims_online_sync_control control ON BINARY control.business_id = BINARY job.business_id
              WHERE BINARY job.business_id = BINARY ? AND BINARY job.channel_instance_id = BINARY ?
                AND job.provider = ? AND job.operation = 'online_daily_accounting' AND BINARY job.operation_key = BINARY ?
                AND control.rollout_state = 'cutover' AND control.paused = 0 LIMIT 1`,
            [databaseId, channelInstanceId, readiness.provider, date],
          );
          return jobs[0]?.status ?? null;
        });
      }
      const joined = jobStatus === 'processing';
      const queued = jobStatus === 'pending' || joined;
      return NextResponse.json({
        success: false,
        status: readiness.reviewRequired ? 'review' : readiness.ready && queued ? joined ? 'joined' : 'queued' : 'blocked',
        reason: readiness.ready && !queued ? 'accounting_job_unavailable' : readiness.reason,
        queued,
        requiredThrough: readiness.requiredThrough,
        preflightImport: { attempted: false, success: false },
      }, { status: readiness.ready && queued ? 202 : 409 });
    }
    let preflightImport: { attempted: boolean; success: boolean; imported?: number; confirmedDrafts?: number; error?: string } = { attempted: false, success: false };
    if (user.tier !== 'Advisor') {
    preflightImport = { attempted: true, success: false };
    try {
      const fwHost = req.headers.get('x-forwarded-host');
      const origin = fwHost ? `https://${fwHost.split(',')[0].trim()}` : new URL(req.url).origin;
      const cookie = req.headers.get('cookie') ?? '';
      const importRes = await fetch(`${origin}/api/ims/shopify/import-orders`, {
        method: 'POST',
        headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelInstanceId }),
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
    }

    if (preflightImport.attempted && !preflightImport.success) {
      await runImsForBusiness(databaseId, async () => {
        await notifySyncFailure({
          businessId: databaseId,
          source: 'shopify_sync',
          title: 'Shopify Sync Failed — Order Import Preflight',
          message: `Shopify import preflight failed before Xero online batch ${date}. ${preflightImport.error ?? 'Unknown error'}`,
          detail: { date, channel, channelInstanceId, error: preflightImport.error ?? null },
          dedupeKey: `shopify:preflight:${channelInstanceId}:${date}`,
          dedupeMinutes: 120,
        }).catch(() => {});
      }).catch(() => {});
    }

    const result = await syncOnlineDailySalesDay(databaseId, date, channelInstanceId);
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
    await reportRuntimeIssue({
      businessId: databaseId,
      source: 'xero_daily_sales',
      operation: 'request_daily_accounting',
      title: 'Online daily accounting request failed',
      error: new Error('Online daily accounting request failed.'),
      context: { date, channel, channelInstanceId },
      reference: { type: 'online_daily_accounting', id: `${channelInstanceId}:${date}` },
    });
    await runImsForBusiness(databaseId, async () => {
      await notifySyncFailure({
        businessId: databaseId,
        source: 'xero_sync',
        title: 'Xero Sync Failed — Online Daily Batch',
        message: `Online daily sales batch ${date} failed. ${err?.message ?? 'Unknown error'}`,
        detail: { date, channel, channelInstanceId, error: err?.message ?? String(err) },
        dedupeKey: `xero:online-batch:${channelInstanceId}:${date}`,
        dedupeMinutes: 60,
      }).catch(() => {});
    }).catch(() => {});
    return NextResponse.json({ error: `Daily sales sync failed: ${err?.message ?? 'unknown error'}` }, { status: 500 });
  }
}
