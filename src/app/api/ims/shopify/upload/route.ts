import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsProductsRepo, ImsImagesRepo, ImsShopifyRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { product_ids }: { product_ids: string[] } = await req.json();
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'product_ids array required.' }, { status: 400 });
    }

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
    const accessToken = decrypt(encToken);
    const shopify = new ShopifyService(shopName, accessToken);

    const results: Array<{ product_id: string; name: string; success: boolean; shopify_id?: string; error?: string }> = [];

    for (const product_id of product_ids) {
      const product = await ImsProductsRepo.get(product_id);
      if (!product) { results.push({ product_id, name: '?', success: false, error: 'Not found' }); continue; }

      try {
        // Build Shopify product payload from IMS data
        const shopifyVariants = (product.variants ?? []).map(v => ({
          sku:       v.sku ?? '',
          barcode:   v.barcode ?? undefined,
          price:     String(v.price ?? '0.00'),
          compare_at_price: v.discounted_price ? String(v.price ?? '0.00') : undefined,
          weight:    v.weight_kg ? v.weight_kg * 1000 : undefined, // grams
          weight_unit: 'g',
          option1:   v.option1_value ?? 'Default',
          option2:   v.option2_value ?? undefined,
          option3:   v.option3_value ?? undefined,
          inventory_management: 'shopify',
          inventory_policy: 'deny',
        }));

        const options = [];
        if (product.variants?.some(v => v.option1_name)) {
          options.push({ name: product.variants![0]?.option1_name ?? 'Option 1' });
        }
        if (product.variants?.some(v => v.option2_name)) {
          options.push({ name: product.variants![0]?.option2_name ?? 'Option 2' });
        }
        if (product.variants?.some(v => v.option3_name)) {
          options.push({ name: product.variants![0]?.option3_name ?? 'Option 3' });
        }

        const payload: any = {
          title:        product.name,
          vendor:       product.brand ?? '',
          product_type: product.product_type ?? '',
          tags:         product.tags ?? '',
          status:       'active',
          variants:     shopifyVariants.length > 0 ? shopifyVariants : [{ price: '0.00' }],
          options:      options.length > 0 ? options : undefined,
        };

        // Include IMS-stored images if any
        const imsImages = await ImsImagesRepo.list(product_id);
        if (imsImages.length > 0) {
          payload.images = imsImages.map((img, i) => ({
            src: img.url,
            position: i + 1,
            alt: img.alt_text ?? '',
          }));
        }

        const created = await shopify.createProduct(payload);
        await ImsShopifyRepo.linkProduct(product_id, String(created.id));

        // Link each variant back
        for (let i = 0; i < (product.variants ?? []).length; i++) {
          const imsVariant = product.variants![i];
          const shopifyVar = created.variants?.[i];
          if (shopifyVar) {
            await ImsShopifyRepo.linkVariant(
              imsVariant.variant_id,
              String(shopifyVar.id),
              String(shopifyVar.inventory_item_id ?? ''),
            );
          }
        }

        results.push({ product_id, name: product.name, success: true, shopify_id: String(created.id) });
      } catch (err: any) {
        results.push({ product_id, name: product.name, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const status = successCount === results.length ? 'success' : successCount > 0 ? 'partial' : 'error';
    await ImsShopifyRepo.logAction('upload', status,
      `Uploaded ${successCount}/${results.length} products to Shopify`, { results });

    return NextResponse.json({ success: true, results, uploaded: successCount, total: results.length });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('upload', 'error', e.message).catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
