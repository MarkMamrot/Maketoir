import { NextResponse } from 'next/server';

import { syncAmazonOrdersForChannel } from '@/lib/channels/amazonOrderSync';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ActiveAmazonChannelRow {
  business_id: string;
  channel_instance_id: string;
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const channels = await query<ActiveAmazonChannelRow>(
    `SELECT instance.business_id, instance.channel_instance_id
       FROM sales_channel_instances instance
       JOIN businesses business ON BINARY business.business_id = BINARY instance.business_id
      WHERE instance.provider = 'amazon'
        AND instance.is_enabled = 1
        AND instance.runtime_status = 'active'
        AND instance.readiness_status = 'ready'
        AND business.deleted_at IS NULL
        AND COALESCE(business.automation_paused, 0) = 0
      ORDER BY instance.business_id, instance.channel_instance_id`,
  );
  const totals = { channels: channels.length, scanned: 0, imported: 0, updated: 0, skipped: 0, failed: 0, pendingChannels: 0 };
  let failedChannels = 0;
  for (const channel of channels) {
    try {
      const result = await syncAmazonOrdersForChannel({
        businessId: channel.business_id, channelInstanceId: channel.channel_instance_id, limit: 25,
      });
      totals.scanned += result.scanned;
      totals.imported += result.imported;
      totals.updated += result.updated;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
      if (result.hasMore) totals.pendingChannels += 1;
    } catch (error) {
      failedChannels += 1;
      await reportRuntimeIssue({
        businessId: channel.business_id, source: 'amazon.orders', operation: 'automatic_order_sync',
        title: 'Automatic Amazon order synchronization failed', error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
  }
  return NextResponse.json(
    { success: failedChannels === 0 && totals.failed === 0, ...totals, failedChannels },
    { status: failedChannels === 0 && totals.failed === 0 ? 200 : 207 },
  );
}