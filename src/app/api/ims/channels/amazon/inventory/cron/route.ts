import { NextResponse } from 'next/server';

import { syncChangedAmazonInventoryForChannel } from '@/lib/channels/amazonInventorySync';
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

  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body?.limit ?? 100))));
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

  const totals = { channels: channels.length, queued: 0, processed: 0, pushed: 0, skipped: 0, failed: 0 };
  let failedChannels = 0;
  for (const channel of channels) {
    try {
      const result = await syncChangedAmazonInventoryForChannel({
        businessId: channel.business_id,
        channelInstanceId: channel.channel_instance_id,
        limit,
      });
      totals.queued += result.queued;
      totals.processed += result.processed;
      totals.pushed += result.pushed;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
    } catch (error) {
      failedChannels += 1;
      await reportRuntimeIssue({
        businessId: channel.business_id,
        source: 'amazon.inventory',
        operation: 'automatic_inventory_sync',
        title: 'Automatic Amazon inventory synchronization failed',
        error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
  }

  return NextResponse.json(
    { success: failedChannels === 0, ...totals, failedChannels },
    { status: failedChannels === 0 ? 200 : 207 },
  );
}