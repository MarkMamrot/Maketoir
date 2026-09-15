import { NextResponse } from 'next/server';

import { retryAmazonShipmentConfirmationsForChannel } from '@/lib/ims/shipping/shippingDispatch';
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
  const totals = { channels: channels.length, attempted: 0, completed: 0, failed: 0, failedChannels: 0 };
  for (const channel of channels) {
    try {
      const result = await retryAmazonShipmentConfirmationsForChannel({
        businessId: channel.business_id,
        channelInstanceId: channel.channel_instance_id,
        limit: 20,
      });
      totals.attempted += result.attempted;
      totals.completed += result.completed;
      totals.failed += result.failed;
    } catch (error) {
      totals.failedChannels += 1;
      await reportRuntimeIssue({
        businessId: channel.business_id,
        source: 'amazon.fulfilments',
        operation: 'automatic_shipment_confirmation',
        title: 'Automatic Amazon shipment confirmation failed',
        error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
  }
  return NextResponse.json({
    success: totals.failed === 0 && totals.failedChannels === 0,
    ...totals,
  }, { status: totals.failedChannels === 0 ? 200 : 207 });
}
