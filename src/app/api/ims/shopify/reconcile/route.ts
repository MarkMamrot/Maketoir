import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const conn = await ConnectionsRepository.get(session.businessId);
    const rawShopId = conn?.shopify_shop_id ?? '';
    const encToken  = conn?.shopify_access_token ?? '';
    if (!rawShopId || !encToken) {
      return NextResponse.json({ success: false, error: 'Shopify not connected.' }, { status: 400 });
    }
    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ success: false, error: 'Invalid Shopify shop name.' }, { status: 400 });
    }
    const accessToken = decrypt(encToken);
    const shopify = new ShopifyService(shopName, accessToken);

    // 1. Fetch all Shopify products
    const shopifyProducts = await shopify.getAllProducts();

    // 2. Build lookup maps: sku → variant info, barcode → variant info
    const shopifyBySku     = new Map<string, { productId: string; variantId: string; inventoryItemId: string }>();
    const shopifyByBarcode = new Map<string, { productId: string; variantId: string; inventoryItemId: string }>();
    for (const p of shopifyProducts) {
      for (const v of (p.variants ?? [])) {
        const entry = {
          productId:       String(p.id),
          variantId:       String(v.id),
          inventoryItemId: String(v.inventory_item_id ?? ''),
        };
        if (v.sku)     shopifyBySku.set(v.sku.trim(), entry);
        if (v.barcode) shopifyByBarcode.set(v.barcode.trim(), entry);
      }
    }

    // 3. Fetch IMS variants for this business only
    const imsVariants = await imsQuery<{
      variant_id: string; product_id: string; sku: string | null; barcode: string | null;
    }>(`SELECT variant_id, product_id, sku, barcode FROM ims_product_variants WHERE is_active = 1 AND business_id = ?`,
      [session.businessId]);

    let matched = 0;
    const unmatchedIms: string[] = [];

    for (const v of imsVariants) {
      const hit = (v.sku ? shopifyBySku.get(v.sku.trim()) : null)
               ?? (v.barcode ? shopifyByBarcode.get(v.barcode.trim()) : null);

      if (hit) {
        await ImsShopifyRepo.linkProduct(v.product_id, hit.productId, session.businessId);
        await ImsShopifyRepo.linkVariant(v.variant_id, hit.variantId, hit.inventoryItemId, session.businessId);
        matched++;
      } else {
        unmatchedIms.push(v.sku ?? v.barcode ?? v.variant_id);
      }
    }

    const unmatchedShopifyCount = shopifyBySku.size - matched;
    const summary = `Matched ${matched} of ${imsVariants.length} IMS variants to Shopify`;
    await ImsShopifyRepo.logAction('reconcile', matched > 0 ? 'success' : 'partial', summary, session.businessId, {
      matched, unmatched_ims: unmatchedIms.length, unmatched_shopify: unmatchedShopifyCount,
    });

    return NextResponse.json({
      success: true, matched,
      unmatched_ims: unmatchedIms.length,
      unmatched_shopify: unmatchedShopifyCount,
      unmatched_ims_samples: unmatchedIms.slice(0, 20),
      summary,
    });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('reconcile', 'error', e.message, session?.businessId ?? '').catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
