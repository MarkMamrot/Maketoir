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
    const shopifyProductCount = shopifyProducts.length;

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

    // 4. Collect matches in memory — no DB writes yet
    type VariantLink  = { variantId: string; shopifyVariantId: string; shopifyInventoryItemId: string };
    type ProductLink  = { productId: string; shopifyProductId: string };

    const variantLinks  = new Map<string, VariantLink>();   // keyed by variant_id (deduped)
    const productLinks  = new Map<string, ProductLink>();   // keyed by product_id (deduped)
    const unmatchedIms: string[] = [];

    for (const v of imsVariants) {
      const hit = (v.sku    ? shopifyBySku.get(v.sku.trim())     : null)
               ?? (v.barcode ? shopifyByBarcode.get(v.barcode.trim()) : null);
      if (hit) {
        variantLinks.set(v.variant_id, {
          variantId:             v.variant_id,
          shopifyVariantId:      hit.variantId,
          shopifyInventoryItemId: hit.inventoryItemId,
        });
        productLinks.set(v.product_id, {
          productId:      v.product_id,
          shopifyProductId: hit.productId,
        });
      } else {
        unmatchedIms.push(v.sku ?? v.barcode ?? v.variant_id);
      }
    }

    const matched = variantLinks.size;

    // 5. Bulk-update variants in chunks of 500 (avoids per-row round-trips)
    const CHUNK = 500;
    const vLinks = [...variantLinks.values()];
    for (let i = 0; i < vLinks.length; i += CHUNK) {
      const chunk = vLinks.slice(i, i + CHUNK);
      const ids   = chunk.map(l => l.variantId);
      const vidParams   = chunk.flatMap(l => [l.variantId, l.shopifyVariantId]);
      const invParams   = chunk.flatMap(l => [l.variantId, l.shopifyInventoryItemId]);
      const whenVid     = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const whenInv     = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const inList      = ids.map(() => '?').join(',');
      await imsExecute(
        `UPDATE ims_product_variants
           SET shopify_variant_id           = CASE variant_id ${whenVid} END,
               shopify_inventory_item_id    = CASE variant_id ${whenInv} END
         WHERE business_id = ? AND variant_id IN (${inList})`,
        [...vidParams, ...invParams, session.businessId, ...ids],
      );
    }

    // 6. Bulk-update products in chunks of 500
    const pLinks = [...productLinks.values()];
    for (let i = 0; i < pLinks.length; i += CHUNK) {
      const chunk   = pLinks.slice(i, i + CHUNK);
      const ids     = chunk.map(l => l.productId);
      const pidParams = chunk.flatMap(l => [l.productId, l.shopifyProductId]);
      const whenPid   = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const inList    = ids.map(() => '?').join(',');
      await imsExecute(
        `UPDATE ims_products
           SET shopify_product_id = CASE product_id ${whenPid} END
         WHERE business_id = ? AND product_id IN (${inList})`,
        [...pidParams, session.businessId, ...ids],
      );
    }

    const unmatchedShopifyCount = shopifyBySku.size - matched;
    const summary = `Matched ${matched} of ${imsVariants.length} IMS variants to Shopify`;
    await ImsShopifyRepo.logAction('reconcile', matched > 0 ? 'success' : 'partial', summary, session.businessId, {
      matched, unmatched_ims: unmatchedIms.length, unmatched_shopify: unmatchedShopifyCount,
    });

    return NextResponse.json({
      success: true, matched,
      shopify_products_fetched: shopifyProductCount,
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
