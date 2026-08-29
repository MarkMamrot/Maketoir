import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { decrypt } from '@/lib/encryption';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';

/**
 * POST /api/website/update-product
 * Body: {
 *   databaseId: string,
 *   productId: number,
 *   variantId: number,
 *   productUpdates: { title?, body_html?, product_type?, vendor?, tags?, status? },
 *   variantUpdates: { price?, compare_at_price?, sku?, barcode? },
 * }
 *
 * Applies field-level updates to a Shopify product and/or its primary variant.
 * Only keys present in productUpdates / variantUpdates are sent to Shopify.
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();
  const { databaseId, productId, variantId, productUpdates = {}, variantUpdates = {} } = body;

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }
  const user = JSON.parse(session.value);
  if (databaseId !== user.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }
  const disabled = await shopifyDisabledResponse(databaseId);
  if (disabled) return disabled;
  if (!productId) {
    return NextResponse.json({ success: false, error: 'productId is required.' }, { status: 400 });
  }

  // Guard against no-op requests
  const hasProductChanges = Object.keys(productUpdates).length > 0;
  const hasVariantChanges = Object.keys(variantUpdates).length > 0;
  if (!hasProductChanges && !hasVariantChanges) {
    return NextResponse.json({ success: true, message: 'No changes to apply.' });
  }

  try {
    // ── Read Shopify credentials ────────────────────────────────────────────
    const credentials = await getShopifyAdminCredentials(databaseId);
    if (!credentials) {
      return NextResponse.json(
        { success: false, error: 'Shopify credentials not configured.' },
        { status: 400 },
      );
    }
    const shopify = new ShopifyService(credentials.shopDomain, credentials.token);

    // ── Apply updates ───────────────────────────────────────────────────────
    if (hasProductChanges) {
      await shopify.updateProduct(Number(productId), productUpdates);
    }
    if (hasVariantChanges && variantId) {
      await shopify.updateVariant(Number(variantId), variantUpdates);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[update-product] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
