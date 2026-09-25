import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { ShopifyService } from '@/services/ShopifyService';
import { syncShopifyGiftCardSnapshots } from '@/lib/ims/shopifyGiftCardSync';

// POST /api/ims/shopify/sync-gift-cards
// Upserts all Shopify gift cards into IMS (matched by shopify_gc_id).
// New cards use last_characters as a code placeholder (resolved to full code on first POS scan).
// Existing cards have status, currency, expires_on, and created_at refreshed from Shopify.
// The card's code and balance in IMS are never overwritten.
export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const businessId = session.businessId;
  const body = await req.json().catch(() => null);
  const channelInstanceId = typeof body?.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  if (!channelInstanceId) {
    return NextResponse.json({ error: 'Select a Shopify store before syncing gift cards.' }, { status: 400 });
  }

  try {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    if (shopifyInstanceSettings(context.instance.settings).giftCards.mode !== 'combined') {
      return NextResponse.json({ error: 'Gift-card synchronization is disabled for this Shopify store.' }, { status: 409 });
    }
    const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
    const result = await syncShopifyGiftCardSnapshots(businessId, channelInstanceId, shopify);
    return NextResponse.json(result, { status: result.errors ? 207 : 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Shopify API error: ${message}` }, { status: 502 });
  }
}
