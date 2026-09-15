import { NextResponse } from 'next/server';

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
  const totals = { channels: channels.length, requested: 0, pending: 0, complete: 0, observed: 0, ignored: 0, failed: 0 };
  for (const channel of channels) {
    try {
      const result = await syncAmazonReturnsForChannel({
        businessId: channel.business_id, channelInstanceId: channel.channel_instance_id,
      });
      totals[result.state] += 1;
      totals.observed += result.observed;
      totals.ignored += result.ignored;
    } catch (error) {
      totals.failed += 1;
      await reportRuntimeIssue({
        businessId: channel.business_id, source: 'amazon.returns', operation: 'automatic_returns_sync',
        title: 'Automatic Amazon returns synchronization failed', error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
  }
  return NextResponse.json({ success: totals.failed === 0, ...totals }, { status: totals.failed === 0 ? 200 : 207 });
}