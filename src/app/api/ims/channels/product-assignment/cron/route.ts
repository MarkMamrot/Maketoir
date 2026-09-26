import { NextResponse } from 'next/server';

import { runChannelProductAssignmentAutomation } from '@/lib/channels/channelProductAssignmentAutomation';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface AssignmentChannelRow {
  business_id: string;
  channel_instance_id: string;
  assignment_mode: 'add_matches';
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const batchSize = Math.max(1, Math.min(500, Math.floor(Number(body?.batchSize ?? 500))));
  const channels = await query<AssignmentChannelRow>(
    `SELECT instance.business_id, instance.channel_instance_id,
            JSON_UNQUOTE(JSON_EXTRACT(instance.settings_json, '$.productAssignmentMode')) AS assignment_mode
       FROM sales_channel_instances instance
       JOIN businesses business ON BINARY business.business_id = BINARY instance.business_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(instance.settings_json, '$.productAssignmentMode')) = 'add_matches'
        AND instance.enabled = 1 AND instance.runtime_status = 'active' AND instance.readiness_status = 'ready'
        AND business.deleted_at IS NULL AND COALESCE(business.automation_paused, 0) = 0
      ORDER BY instance.business_id, instance.channel_instance_id`,
  );
  let evaluated = 0;
  let failedChannels = 0;
  for (const channel of channels) {
    try {
      const result = await runChannelProductAssignmentAutomation({
        businessId: channel.business_id,
        channelInstanceId: channel.channel_instance_id,
        mode: channel.assignment_mode,
        batchSize,
      });
      evaluated += result.evaluated;
    } catch (error) {
      failedChannels += 1;
      await reportRuntimeIssue({
        businessId: channel.business_id,
        source: 'sales_channels',
        operation: 'automatic_product_assignment',
        title: 'Automatic channel product assignment failed',
        error,
        context: { channelInstanceId: channel.channel_instance_id, mode: channel.assignment_mode },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id },
      }).catch(() => null);
    }
  }
  return NextResponse.json({ success: failedChannels === 0, channels: channels.length, evaluated, failedChannels },
    { status: failedChannels === 0 ? 200 : 207 });
}