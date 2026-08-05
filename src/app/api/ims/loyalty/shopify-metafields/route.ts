import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
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
  if (requestedContactId != null && (!Number.isInteger(requestedContactId) || requestedContactId <= 0)) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }
  const afterId = Math.max(0, Number(body.afterId) || 0);
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));

  try {
    const connection = await ConnectionsRepository.get(session.businessId);
    if (!connection?.shopify_shop_id || !connection.shopify_access_token) {
      return NextResponse.json({ error: 'Shopify credentials are not configured.' }, { status: 400 });
    }
    let accessToken = connection.shopify_access_token;
    try { accessToken = decrypt(accessToken); } catch { /* Legacy unencrypted token. */ }
    const shopify = new ShopifyService(connection.shopify_shop_id, accessToken);

    const contactIds = requestedContactId != null
      ? [requestedContactId]
      : (await imsQuery<{ id: number }>(
          `SELECT id
             FROM ims_contacts
            WHERE business_id = ? AND deleted_at IS NULL AND shopify_customer_id IS NOT NULL
              AND shopify_customer_id <> '' AND type IN ('retail_customer','b2b_customer','both') AND id > ?
            ORDER BY id
            LIMIT ?`,
          [session.businessId, afterId, limit + 1],
        )).map(row => Number(row.id));
    const hasMore = requestedContactId == null && contactIds.length > limit;
    const batch = contactIds.slice(0, requestedContactId == null ? limit : 1);
    const results = [];
    for (const contactId of batch) {
      results.push(await ShopifyLoyaltyMetafieldService.syncCustomer({
        businessId: session.businessId,
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
    return NextResponse.json({ error: 'Shopify loyalty catch-up failed.' }, { status: 500 });
  }
}