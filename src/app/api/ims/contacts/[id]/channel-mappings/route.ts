import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listContactChannelMappingsForContact } from '@/lib/ims/contactChannelMappings';
import { query } from '@/services/MySQLService';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contactId = Number(params.id);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }

  const mappings = await listContactChannelMappingsForContact({ businessId: session.businessId, contactId });
  if (mappings.length === 0) return NextResponse.json({ success: true, mappings: [] });
  const channelIds = mappings.map(mapping => mapping.channelInstanceId);
  const channels = await query<{ channel_instance_id: string; display_name: string; external_account_key: string | null }>(
    `SELECT channel_instance_id, display_name, external_account_key
       FROM sales_channel_instances
      WHERE business_id = ? AND provider = 'shopify'
        AND channel_instance_id IN (${channelIds.map(() => '?').join(',')})`,
    [session.businessId, ...channelIds],
  );
  const channelById = new Map(channels.map(channel => [channel.channel_instance_id, channel]));
  return NextResponse.json({
    success: true,
    mappings: mappings.map(mapping => ({
      channelInstanceId: mapping.channelInstanceId,
      displayName: channelById.get(mapping.channelInstanceId)?.display_name ?? 'Unknown Shopify store',
      shopDomain: channelById.get(mapping.channelInstanceId)?.external_account_key ?? null,
      externalCustomerId: mapping.externalCustomerId,
    })),
  });
}