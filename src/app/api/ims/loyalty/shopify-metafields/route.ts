import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext, ShopifyOperationContextError } from '@/lib/channels/shopifyOperationContext';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* Empty body starts a bulk sync. */ }
  const requestedContactId = body.contactId == null ? null : Number(body.contactId);
  const channelInstanceId = typeof body.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  if (!channelInstanceId) return NextResponse.json({ error: 'channelInstanceId is required.' }, { status: 400 });
  if (requestedContactId != null && (!Number.isInteger(requestedContactId) || requestedContactId <= 0)) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }
  const afterId = Math.max(0, Number(body.afterId) || 0);
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
  const queryLimit = limit + 1;

  try {
    const context = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);

    const contactIds = requestedContactId != null
      ? [requestedContactId]
      : (await imsQuery<{ id: number }>(
           `SELECT ims_contacts.id
             FROM ims_contacts
            JOIN ims_contact_channel_mappings mapping
              ON mapping.business_id = ims_contacts.business_id AND mapping.contact_id = ims_contacts.id
             AND mapping.channel_instance_id = ? AND mapping.mapping_status = 'linked'
            WHERE ims_contacts.business_id = ? AND ims_contacts.is_active = 1
              AND ims_contacts.type IN ('retail_customer','b2b_customer','both') AND ims_contacts.id > ?
            ORDER BY ims_contacts.id
            LIMIT ${queryLimit}`,
          [channelInstanceId, session.businessId, afterId],
        )).map(row => Number(row.id));
    const hasMore = requestedContactId == null && contactIds.length > limit;
    const batch = contactIds.slice(0, requestedContactId == null ? limit : 1);
    const results = [];
    for (const contactId of batch) {
      results.push(await ShopifyLoyaltyMetafieldService.syncCustomer({
        businessId: session.businessId,
        channelInstanceId,
        contactId,
        shopify,
      }));
    }

    return NextResponse.json({
      success: results.every(result => result.status !== 'failed'),
      processed: results.length,
      synced: results.filter(result => result.status === 'synced').length,
      failed: results.filter(result => result.status === 'failed').length,
      skipped: results.filter(result => result.status === 'skipped').length,
      results,
      nextAfterId: hasMore ? batch[batch.length - 1] : null,
      hasMore,
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'shopify_loyalty',
      operation: 'bulk_sync_customer_metafields',
      title: 'Shopify loyalty metafield catch-up failed',
      error,
      context: { requestedContactId, afterId, limit },
      reference: requestedContactId == null ? undefined : { type: 'ims_contact', id: requestedContactId },
    });
    if (error instanceof ShopifyOperationContextError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Shopify loyalty catch-up failed.' }, { status: 500 });
  }
}