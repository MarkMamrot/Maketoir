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

    const results: Array<{ product_id: string; name: string; success: boolean; shopify_id?: string; error?: string }> = [];

    for (const product_id of product_ids) {
      const product = await ImsProductsRepo.get(product_id);
      if (!product) { results.push({ product_id, name: '?', success: false, error: 'Not found' }); continue; }

      try {
        // Build Shopify product payload from IMS data.
        // Only create option axes that have real non-empty values — prevents spurious
        // "Size: Default" / "Colour: Default" on single-variant / no-option products.
        const hasOpt1 = (product.variants ?? []).some(v => v.option1_name?.trim() && v.option1_value?.trim());
        const hasOpt2 = (product.variants ?? []).some(v => v.option2_name?.trim() && v.option2_value?.trim());
        const hasOpt3 = (product.variants ?? []).some(v => v.option3_name?.trim() && v.option3_value?.trim());
        const shopifyVariants = (product.variants ?? []).map(v => ({
          sku:       v.sku ?? '',
          barcode:   v.barcode ?? undefined,
          price:     String(v.price_rrp ?? '0.00'),
          compare_at_price: v.price_rrp_sale ? String(v.price_rrp ?? '0.00') : undefined,
          weight:    v.weight_kg ? v.weight_kg * 1000 : undefined, // grams
          weight_unit: 'g',
          option1:   hasOpt1 ? (v.option1_value?.trim() || 'Default') : 'Default Title',
          ...(hasOpt2 ? { option2: v.option2_value?.trim() || 'Default' } : {}),
          ...(hasOpt3 ? { option3: v.option3_value?.trim() || 'Default' } : {}),
          inventory_management: 'shopify',
          inventory_policy: 'deny',
        }));

        const options = [];
        if (hasOpt1) options.push({ name: product.variants!.find(v => v.option1_name?.trim())?.option1_name ?? 'Option 1' });
        if (hasOpt2) options.push({ name: product.variants!.find(v => v.option2_name?.trim())?.option2_name ?? 'Option 2' });
        if (hasOpt3) options.push({ name: product.variants!.find(v => v.option3_name?.trim())?.option3_name ?? 'Option 3' });

        const payload: any = {
          title:        (product as any).website_title?.trim() || product.name,
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
        await ImsShopifyRepo.linkProduct(product_id, String(created.id), session.businessId);

        // Link each variant back
        for (let i = 0; i < (product.variants ?? []).length; i++) {
          const imsVariant = product.variants![i];
          const shopifyVar = created.variants?.[i];
          if (shopifyVar) {
            await ImsShopifyRepo.linkVariant(
              imsVariant.variant_id,
              String(shopifyVar.id),
              String(shopifyVar.inventory_item_id ?? ''),
              session.businessId,
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
      `Uploaded ${successCount}/${results.length} products to Shopify`, session.businessId, { results });

    return NextResponse.json({ success: true, results, uploaded: successCount, total: results.length });
  } catch (e: any) {
    await ImsShopifyRepo.logAction('upload', 'error', e.message, session.businessId).catch(() => {});
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
