import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsImagesRepo, ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

/**
 * POST /api/ims/shopify/import-images
 * One-time (or re-runnable) import of Shopify product images into ims_product_images.
 * Matches via shopify_product_id on ims_products.
 */
export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const conn = await ConnectionsRepository.get(session.userSpreadsheetId);
    const rawShopId = conn?.shopify_shop_id ?? '';
    const encToken  = conn?.shopify_access_token ?? '';
    if (!rawShopId || !encToken) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }
    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }
    const shopify = new ShopifyService(shopName, decrypt(encToken));

    // Get all IMS products that are linked to Shopify
    const linked = await imsQuery<{ product_id: string; shopify_product_id: string }>(
      `SELECT product_id, shopify_product_id FROM ims_products
       WHERE shopify_product_id IS NOT NULL AND is_active = 1`,
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

    await ImsShopifyRepo.logAction('reconcile', 'success',
      `Imported images for ${imported} products from Shopify`, { imported, skipped });

    return NextResponse.json({ success: true, imported, skipped, total: linked.length });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
