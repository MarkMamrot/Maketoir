import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { ShopifyService } from '@/services/ShopifyService';
import { syncShopifyGiftCardSnapshots } from '@/lib/ims/shopifyGiftCardSync';

// POST /api/ims/shopify/sync-gift-cards
// Upserts all Shopify gift cards into IMS (matched by shopify_gc_id).
// New cards use last_characters as a code placeholder (resolved to full code on first POS scan).
// Existing cards have status, currency, expires_on, and created_at refreshed from Shopify.
// The card's code and balance in IMS are never overwritten.
export async function POST() {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const businessId = session.businessId;

  const conn = await ConnectionsRepository.get(businessId);
  if (!conn?.shopify_shop_id || !conn?.shopify_access_token)
    return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });

  let token = conn.shopify_access_token;
  try { token = decrypt(token); } catch { /* unencrypted */ }
  const shopify = new ShopifyService(conn.shopify_shop_id, token);

  try {
    const result = await syncShopifyGiftCardSnapshots(businessId, shopify);
    return NextResponse.json(result, { status: result.errors ? 207 : 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Shopify API error: ${message}` }, { status: 502 });
  }
}
