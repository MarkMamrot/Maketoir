import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { ShopifyService } from '@/services/ShopifyService';
import { ImsImagesRepo, ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';


/**
 * POST /api/ims/shopify/import-images
 * One-time (or re-runnable) import of Shopify product images into ims_product_images.
 * Matches via shopify_product_id on ims_products.
 */
export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;

  try {
    const body = await req.json().catch(() => ({}));
    const channelInstanceId = String(body?.channelInstanceId ?? '').trim();
    if (!channelInstanceId) return NextResponse.json({ success: false, error: 'Select a Shopify storefront.' }, { status: 400 });
    const { credentials } = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    const shopify = new ShopifyService(credentials.shopDomain, credentials.token);

    // Get all IMS products for this business that are linked to Shopify
    const linked = await imsQuery<{ product_id: string; shopify_product_id: string }>(
      `SELECT DISTINCT variant.product_id, mapping.external_product_id AS shopify_product_id
         FROM ims_sales_channel_product_mappings mapping
         JOIN ims_product_variants variant
           ON BINARY variant.business_id = BINARY mapping.business_id AND variant.variant_id = mapping.variant_id
         JOIN ims_products product
           ON BINARY product.business_id = BINARY variant.business_id AND product.product_id = variant.product_id
        WHERE mapping.business_id = ? AND mapping.channel_instance_id = ?
          AND mapping.mapping_status = 'linked' AND mapping.external_product_id IS NOT NULL
          AND product.is_active = 1`,
      [session.businessId, channelInstanceId],
    );
    if (!linked.length) {
      return NextResponse.json({ success: true, imported: 0, message: 'No linked products found. Run Reconcile first.' });
    }

    // Fetch all Shopify products (paginated)
    const shopifyProducts = await shopify.getAllProducts();
    const shopifyById = new Map<string, any>(shopifyProducts.map(p => [String(p.id), p]));

    let imported = 0;
    let skipped  = 0;

    for (const { product_id, shopify_product_id } of linked) {
      const sp = shopifyById.get(shopify_product_id);
      if (!sp) { skipped++; continue; }

      const images: Array<{ src: string; alt?: string }> = (sp.images ?? [])
        .slice(0, 5)
        .map((img: any) => ({ src: img.src, alt: img.alt ?? undefined }));

      if (!images.length && sp.image?.src) {
        images.push({ src: sp.image.src });
      }

      if (!images.length) { skipped++; continue; }

      await ImsImagesRepo.upsertFromShopify(product_id, images);
      imported++;
    }

    await ImsShopifyRepo.logAction('upload', 'success',
      `Imported images for ${imported} products from Shopify`, session.businessId, { imported, skipped }, channelInstanceId);

    return NextResponse.json({ success: true, channelInstanceId, imported, skipped, total: linked.length });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
