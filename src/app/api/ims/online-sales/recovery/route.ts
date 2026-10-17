import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { getOnlineSyncControl } from '@/lib/channels/onlineSyncControl';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requestOnlineRecovery } from '@/lib/channels/onlineRecoveryWorker';
import { OnlineSyncLeaseLostError } from '@/lib/channels/onlineSyncPolicy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    return await runImsForBusiness(session.businessId, async () => {
      const control = await getOnlineSyncControl(session.businessId);
      if (control.mode === 'legacy') return NextResponse.json({ ...control, channels: [] });
      const instances = await SalesChannelInstanceRepository.listForBusiness(session.businessId);
      const channels = [];
      for (const channel of instances.filter(instance => instance.provider === 'shopify' || instance.provider === 'native_shop')) {
        const [state] = await imsQuery<{
          baseline_complete: number; covered_through: string | null; next_check_at: string | null; safe_error_code: string | null;
        }>(
          `SELECT baseline_complete,DATE_FORMAT(covered_through,'%Y-%m-%dT%H:%i:%sZ') AS covered_through,
             DATE_FORMAT(next_check_at,'%Y-%m-%dT%H:%i:%sZ') AS next_check_at,safe_error_code
            FROM ims_shopify_reconciliation WHERE business_id = ? AND channel_instance_id = ?`,
          [session.businessId, channel.channelInstanceId],
        );
        const [jobs] = await imsQuery<{ pending: number; failed: number; safe_error: string | null }>(
          `SELECT SUM(status IN ('pending','processing')) AS pending,SUM(status = 'failed') AS failed,
             MAX(CASE WHEN status = 'failed' THEN safe_error END) AS safe_error
            FROM ims_sales_channel_jobs WHERE business_id = ? AND channel_instance_id = ?
              AND operation IN ('shopify_order_reconcile','shopify_order_apply','online_daily_accounting')`,
          [session.businessId, channel.channelInstanceId],
        );
        const reviews = await imsQuery<{ external_order_id: string; review_reason: string }>(
          `SELECT external_order_id,review_reason FROM ims_shopify_order_recovery
            WHERE business_id = ? AND channel_instance_id = ? AND review_reason IS NOT NULL
            ORDER BY updated_at LIMIT 30`, [session.businessId, channel.channelInstanceId],
        );
        const [reviewCount] = await imsQuery<{ total: number }>(
          `SELECT COUNT(*) AS total FROM ims_shopify_order_recovery
            WHERE business_id = ? AND channel_instance_id = ? AND review_reason IS NOT NULL`,
          [session.businessId, channel.channelInstanceId],
        );
        channels.push({
          channelInstanceId: channel.channelInstanceId, displayName: channel.displayName,
          baselineComplete: channel.provider === 'native_shop' || Number(state?.baseline_complete) === 1,
          coveredThrough: state?.covered_through ?? null, nextCheckAt: state?.next_check_at ?? null,
          safeErrorCode: state?.safe_error_code ?? jobs?.safe_error ?? null,
          pendingJobs: Number(jobs?.pending ?? 0), failedJobs: Number(jobs?.failed ?? 0),
          reviewOrders: reviews.map(row => ({ externalOrderId: row.external_order_id, reason: row.review_reason })),
          reviewOrderCount: Number(reviewCount?.total ?? 0),
          reviewOrdersTruncated: Number(reviewCount?.total ?? 0) > reviews.length,
        });
      }
      return NextResponse.json({ ...control, channels });
    });
  } catch {
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'online_recovery', operation: 'load_status',
      title: 'Online recovery status could not be loaded', error: new Error('Recovery status query failed.'),
    });
    return NextResponse.json({ error: 'Online recovery status is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (session.tier !== 'Admin' && session.tier !== 'SuperAdmin') {
    return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'A valid recovery action is required.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !('action' in body)
    || !['retry', 'pause', 'resume'].includes(String(body.action))) {
    return NextResponse.json({ error: 'A valid recovery action is required.' }, { status: 400 });
  }
  const action = String(body.action);
  const channelInstanceId = 'channelInstanceId' in body ? body.channelInstanceId : undefined;
  if (channelInstanceId !== undefined && (typeof channelInstanceId !== 'string' || !channelInstanceId.trim())) {
    return NextResponse.json({ error: 'Select an exact storefront.' }, { status: 400 });
  }
  try {
    return await runImsForBusiness(session.businessId, async () => {
      const control = await getOnlineSyncControl(session.businessId);
      if (control.mode === 'legacy') {
        return NextResponse.json({ error: 'Scheduled recovery has not been activated.' }, { status: 409 });
      }
      if (typeof channelInstanceId === 'string') {
        const instance = await SalesChannelInstanceRepository.getForBusiness(session.businessId, channelInstanceId);
        if (!instance || !['shopify','native_shop'].includes(instance.provider)) {
          return NextResponse.json({ error: 'Storefront not found.' }, { status: 404 });
        }
      }
      if (action === 'pause' || action === 'resume') {
        await imsExecute(
          `UPDATE ims_online_sync_control SET paused = ? WHERE business_id = ? AND rollout_state IN ('validation','cutover')`,
          [action === 'pause' ? 1 : 0, session.businessId],
        );
      } else {
        if (control.paused) {
          return NextResponse.json({ error: 'Resume scheduled recovery before retrying.' }, { status: 409 });
        }
        await requestOnlineRecovery(session.businessId, typeof channelInstanceId === 'string' ? channelInstanceId : undefined);
        await imsExecute(
          `UPDATE ims_sales_channel_jobs SET status = 'pending',available_at = UTC_TIMESTAMP(3),
             payload_json = JSON_REMOVE(payload_json,'$.blockedReason')
            WHERE business_id = ? AND operation IN ('shopify_order_reconcile','shopify_order_apply','online_daily_accounting')
              AND (status IN ('pending','failed') OR (status = 'processing' AND lease_expires_at <= UTC_TIMESTAMP(3)))
              ${typeof channelInstanceId === 'string' ? 'AND channel_instance_id = ?' : ''}`,
          typeof channelInstanceId === 'string' ? [session.businessId, channelInstanceId] : [session.businessId],
        );
      }
      return NextResponse.json({ queued: action === 'retry', paused: action === 'pause' ? true : action === 'resume' ? false : control.paused });
    });
  } catch (error) {
    if (error instanceof OnlineSyncLeaseLostError) {
      return NextResponse.json({ error: 'Background automation is paused or this business is unavailable.' }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId, source: 'online_recovery', operation: 'update_control',
      title: 'Online recovery control could not be updated', error: new Error('Recovery control write failed.'),
      context: { action, channelInstanceId: typeof channelInstanceId === 'string' ? channelInstanceId : null },
    });
    return NextResponse.json({ error: 'Online recovery action could not be saved.' }, { status: 503 });
  }
}
