import { NextResponse } from 'next/server';

import { syncAmazonRefundsForChannel } from '@/lib/channels/amazonRefundSync';
import { syncAmazonReturnsForChannel } from '@/lib/channels/amazonReturnSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const channels = await query<{ business_id: string; channel_instance_id: string }>(
    `SELECT instance.business_id, instance.channel_instance_id
       FROM sales_channel_instances instance
       JOIN businesses business ON BINARY business.business_id = BINARY instance.business_id
      WHERE instance.provider = 'amazon' AND instance.is_enabled = 1
        AND instance.runtime_status = 'active' AND instance.readiness_status = 'ready'
        AND business.deleted_at IS NULL AND COALESCE(business.automation_paused, 0) = 0
      ORDER BY instance.business_id, instance.channel_instance_id`,
  );
  const totals = {
    channels: channels.length, requested: 0, pending: 0, complete: 0,
    returnsObserved: 0, refundsObserved: 0, draftsCreated: 0, ambiguous: 0, ignored: 0, failedChannels: 0,
  };
  for (const channel of channels) {
    let failed = false;
    try {
      const result = await syncAmazonReturnsForChannel({
        businessId: channel.business_id, channelInstanceId: channel.channel_instance_id,
      });
      totals[result.state] += 1;
      totals.returnsObserved += result.observed;
      totals.ignored += result.ignored;
    } catch (error) {
      failed = true;
      await reportRuntimeIssue({
        businessId: channel.business_id, source: 'amazon.returns', operation: 'automatic_returns_sync',
        title: 'Automatic Amazon returns synchronization failed', error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
    try {
      const result = await syncAmazonRefundsForChannel({
        businessId: channel.business_id, channelInstanceId: channel.channel_instance_id,
      });
      totals.refundsObserved += result.observed;
      totals.draftsCreated += result.created;
      totals.ambiguous += result.ambiguous;
      totals.ignored += result.ignored;
    } catch (error) {
      failed = true;
      await reportRuntimeIssue({
        businessId: channel.business_id, source: 'amazon.refunds', operation: 'automatic_refunds_sync',
        title: 'Automatic Amazon refund synchronization failed', error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
    if (failed) totals.failedChannels += 1;
  }
  return NextResponse.json({ success: totals.failedChannels === 0, ...totals }, { status: totals.failedChannels === 0 ? 200 : 207 });
}