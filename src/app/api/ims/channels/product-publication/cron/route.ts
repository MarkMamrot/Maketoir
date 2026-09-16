import { NextResponse } from 'next/server';

import { syncChannelProductPublications } from '@/lib/channels/channelProductPublication';
import { channelProductPublicationAdapter } from '@/lib/channels/channelProductPublicationAdapters';
import type { SalesChannelProvider } from '@/lib/channels/types';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query } from '@/services/MySQLService';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface PublicationChannelRow {
  business_id: string;
  channel_instance_id: string;
  provider: SalesChannelProvider;
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body?.limit ?? 25))));
  const channels = await query<PublicationChannelRow>(
    `SELECT instance.business_id, instance.channel_instance_id, instance.provider
       FROM sales_channel_instances instance
       JOIN businesses business ON BINARY business.business_id = BINARY instance.business_id
       LEFT JOIN business_online_channels capability ON BINARY capability.business_id = BINARY instance.business_id
      WHERE instance.is_enabled = 1 AND instance.runtime_status = 'active' AND instance.readiness_status = 'ready'
        AND JSON_UNQUOTE(JSON_EXTRACT(instance.settings_json, '$.productPublicationEnabled')) IN ('1', 'true')
        AND (instance.provider = 'amazon'
          OR (instance.provider = 'shopify' AND capability.shopify_enabled = 1)
          OR (instance.provider = 'native_shop' AND capability.native_shop_enabled = 1))
        AND business.deleted_at IS NULL AND COALESCE(business.automation_paused, 0) = 0
      ORDER BY instance.business_id, instance.channel_instance_id`,
  );
  const totals = { channels: channels.length, queued: 0, processed: 0, applied: 0, blocked: 0, skipped: 0, failed: 0 };
  let failedChannels = 0;
  for (const channel of channels) {
    try {
      const result = await syncChannelProductPublications({
        businessId: channel.business_id, channelInstanceId: channel.channel_instance_id,
        provider: channel.provider, adapter: channelProductPublicationAdapter(channel.provider), limit,
      });
      totals.queued += result.queued;
      totals.processed += result.processed;
      totals.applied += result.applied;
      totals.blocked += result.blocked;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
    } catch (error) {
      failedChannels += 1;
      await reportRuntimeIssue({ businessId: channel.business_id, source: `${channel.provider}.catalogue`,
        operation: 'automatic_product_publication', title: 'Automatic channel product publication failed', error,
        context: { channelInstanceId: channel.channel_instance_id },
        reference: { type: 'sales_channel_instance', id: channel.channel_instance_id } }).catch(() => null);
    }
  }
  return NextResponse.json({ success: failedChannels === 0, ...totals, failedChannels }, { status: failedChannels === 0 ? 200 : 207 });
}