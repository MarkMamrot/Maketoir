/**
 * /api/ims/products/[id]/shopify-sync
 *
 * GET  — Online store status for a product: whether it's linked to Shopify,
 *        the storefront + admin URLs, and the current publish status.
 * POST — Push IMS product data (title, description, tags, price, images) to the
 *        linked Shopify product. Creates the product on Shopify if not yet linked.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { ImsProductsRepo, ImsImagesRepo, ImsShopifyRepo } from '@/lib/ims/ImsRepository';
import { shopifyVariantPricePayload, pushInventoryForBusiness } from '@/lib/ims/shopifyInventorySync';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

async function getShopify(businessId: string) {
  const conn = await ConnectionsRepository.get(businessId) as any;
  const rawShopId = conn?.shopify_shop_id ?? '';
  const encToken  = conn?.shopify_access_token ?? '';
  if (!rawShopId || !encToken) return null;
  const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
  if (!/^[a-zA-Z0-9-]+$/.test(shopName)) return null;
  return { service: new ShopifyService(shopName, decrypt(encToken)), shopName, shopDomain: `${shopName}.myshopify.com` };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const product = await ImsProductsRepo.get(params.id, session.businessId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const shopifyProductId = product.shopify_product_id ?? null;
    const shop = await getShopify(session.businessId);

    if (!shop) {
      return NextResponse.json({ success: true, connected: false, linked: !!shopifyProductId, shopifyProductId });
    }
    if (!shopifyProductId) {
      return NextResponse.json({ success: true, connected: true, linked: false, shopDomain: shop.shopDomain });
    }

    let handle = '';
    let published = false;
    let status = 'unknown';
    try {
      const sp = await shop.service.getProduct(shopifyProductId);
      handle = sp?.handle ?? '';
      published = !!sp?.published_at;
      status = sp?.status ?? 'unknown';
    } catch {}

    return NextResponse.json({
      success: true,
      connected: true,
      linked: true,
      shopifyProductId,
      shopDomain: shop.shopDomain,
      storefrontUrl: handle ? `https://${shop.shopDomain}/products/${handle}` : '',
      adminUrl: `https://admin.shopify.com/store/${shop.shopName}/products/${shopifyProductId}`,
      published,
      status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load status' }, { status: 500 });
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const product = await ImsProductsRepo.get(params.id, session.businessId);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const shop = await getShopify(session.businessId);
    if (!shop) return NextResponse.json({ error: 'Shopify is not connected.' }, { status: 400 });

    const images = await ImsImagesRepo.list(params.id);
    const variants = product.variants ?? [];
    const firstPriced = variants.find(v => v.price_rrp != null);

    // ── If not yet linked → create the product on Shopify ────────────────────
    if (!product.shopify_product_id) {
      // Build options first so variant option slots match exactly what Shopify expects.
      // Shopify rejects a 422 if variant option2/option3 are present but no matching product option.
      const options: any[] = [];
      if (variants.some(v => v.option1_name)) options.push({ name: variants[0]?.option1_name ?? 'Option 1' });
      if (variants.some(v => v.option2_name)) options.push({ name: variants[0]?.option2_name ?? 'Option 2' });
      if (variants.some(v => v.option3_name)) options.push({ name: variants[0]?.option3_name ?? 'Option 3' });

      const shopifyVariants = variants.map(v => {
        const { price, compare_at_price } = shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale);
        const vp: Record<string, any> = {
          sku: v.sku ?? '',
          barcode: v.barcode ?? undefined,
          price,
          compare_at_price: compare_at_price ?? undefined,
          weight: v.weight_kg ? v.weight_kg * 1000 : undefined,
          weight_unit: 'g',
          option1: v.option1_value || 'Default',
          inventory_management: 'shopify',
          inventory_policy: 'deny',
        };
        // Only include option2/option3 when the product-level option is also defined
        if (options.length >= 2) vp.option2 = v.option2_value || 'Default';
        if (options.length >= 3) vp.option3 = v.option3_value || 'Default';
        return vp;
      });

      const payload: any = {
        title: product.name,
        body_html: product.description ?? '',
        vendor: product.brand ?? '',
        product_type: product.product_type ?? '',
        tags: product.tags ?? '',
        status: 'active',
        variants: shopifyVariants.length > 0 ? shopifyVariants : [{ price: String(firstPriced?.price_rrp ?? '0.00') }],
        options: options.length > 0 ? options : undefined,
        images: images.length > 0 ? images.map((img, i) => ({ src: img.url, position: i + 1, alt: img.alt_text ?? '' })) : undefined,
      };
      const created = await shop.service.createProduct(payload);
      await ImsShopifyRepo.linkProduct(params.id, String(created.id), session.businessId);
      for (let i = 0; i < variants.length; i++) {
        const sv = created.variants?.[i];
        if (sv) await ImsShopifyRepo.linkVariant(variants[i].variant_id, String(sv.id), String(sv.inventory_item_id ?? ''), session.businessId);
      }
      // Push inventory quantities using the same pick-location + buffer logic as the live sync
      const variantIds = variants.map(v => v.variant_id);
      const invResult = await pushInventoryForBusiness(session.businessId, { variantIds, force: true }).catch(() => ({ pushed: 0, skipped: 0, errors: ['Inventory push failed'], locationId: null }));
      await ImsShopifyRepo.logAction('upload', 'success', `Created "${product.name}" on Shopify (inventory pushed: ${invResult.pushed})`, session.businessId, { product_id: params.id }).catch(() => {});
      return NextResponse.json({ success: true, created: true, shopifyProductId: String(created.id), inventoryPushed: invResult.pushed, inventoryErrors: invResult.errors });
    }

    // ── Already linked → update title / description / tags / price / images ──
    const shopifyProductId = product.shopify_product_id;
    await shop.service.updateProduct(shopifyProductId, {
      title: product.name,
      body_html: product.description ?? '',
      vendor: product.brand ?? '',
      product_type: product.product_type ?? '',
      tags: product.tags ?? '',
    });

    // Prices per linked variant
    let pricesUpdated = 0;
    for (const v of variants) {
      if (v.shopify_variant_id && v.price_rrp != null) {
        try {
          await shop.service.updateVariant(v.shopify_variant_id, shopifyVariantPricePayload(v.price_rrp, v.price_rrp_sale));
          pricesUpdated++;
        } catch {}
      }
    }

    // Append IMS images not already on the Shopify product (compare by URL, ignoring ?v= params)
    let imagesAdded = 0;
    const imageErrors: string[] = [];
    try {
      const sp = await shop.service.getProduct(shopifyProductId);
      const existing = new Set<string>((sp?.images ?? []).map((im: any) => String(im.src).split('?')[0]));
      for (const img of images) {
        const base = String(img.url).split('?')[0];
        // Only push publicly reachable URLs (Shopify must be able to fetch the src)
        if (!existing.has(base) && /^https?:\/\//i.test(img.url)) {
          try {
            await shop.service.createProductImage(shopifyProductId, { src: img.url, alt: img.alt_text ?? '' });
            imagesAdded++;
          } catch (imgErr: any) {
            const detail = imgErr.response?.body?.errors ?? imgErr.message ?? 'unknown';
            imageErrors.push(`${base.slice(-40)}: ${JSON.stringify(detail).slice(0, 100)}`);
          }
        }
      }
    } catch {}

    await ImsShopifyRepo.logAction('resync', 'success', `Pushed "${product.name}" to Shopify (prices: ${pricesUpdated}, images: +${imagesAdded}${imageErrors.length ? `, ${imageErrors.length} image error(s)` : ''})`, session.businessId, { product_id: params.id }).catch(() => {});

    // Push inventory quantities using the same pick-location + buffer logic as the live sync
    const linkedVariantIds = variants.filter(v => v.shopify_variant_id).map(v => v.variant_id);
    const invResult = await pushInventoryForBusiness(session.businessId, { variantIds: linkedVariantIds, force: true }).catch(() => ({ pushed: 0, skipped: 0, errors: ['Inventory push failed'], locationId: null }));

    return NextResponse.json({ success: true, updated: true, pricesUpdated, imagesAdded, imageErrors, inventoryPushed: invResult.pushed, inventoryErrors: invResult.errors });
  } catch (e: any) {
    // Surface the actual Shopify validation errors when available (e.g. 422 details)
    const shopifyErrors = e.response?.body?.errors ?? e.response?.body ?? null;
    const detail = shopifyErrors
      ? `${e.message}: ${JSON.stringify(shopifyErrors).slice(0, 400)}`
      : (e.message ?? 'Shopify push failed');
    await ImsShopifyRepo.logAction('resync', 'error', detail, session.businessId, { product_id: params.id }).catch(() => {});
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
